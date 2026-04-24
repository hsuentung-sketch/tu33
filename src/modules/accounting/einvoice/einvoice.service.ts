import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { getTenantSettings } from '../../../shared/utils.js';
import { writeAudit } from '../../../shared/audit.js';
import { buildC0401, buildC0501 } from './xml-builder.js';
import { writeIssueXml, writeVoidXml } from './turnkey-writer.js';

export interface IssueItemInput {
  sequence?: number;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount?: number; // defaults to round(quantity * unitPrice)
}

export interface IssueInput {
  receivableId?: string;
  salesOrderId?: string;
  buyerTaxId?: string | null; // null / empty → B2C 二聯式
  buyerName: string;
  buyerAddress?: string;
  items: IssueItemInput[];
  taxType?: string;           // default from tenant settings
  invoiceDate?: Date;         // default now
  createdBy?: string;
}

// ----- pool -----

export async function listPools(tenantId: string, opts: { includeInactive?: boolean } = {}) {
  return prisma.einvoiceNumberPool.findMany({
    where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createPool(tenantId: string, data: {
  yearMonth: string; trackAlpha: string; rangeStart: number; rangeEnd: number;
  note?: string; createdBy?: string;
}) {
  if (!/^[A-Z]{2}$/.test(data.trackAlpha)) {
    throw new ValidationError('字軌必須為兩個大寫英文字母');
  }
  if (!/^\d{3,}$/.test(data.yearMonth)) {
    throw new ValidationError('期別格式錯誤（如 "11311" 代表民國 113 年 11-12 月期）');
  }
  if (data.rangeStart < 0 || data.rangeEnd <= data.rangeStart) {
    throw new ValidationError('起訖號碼錯誤');
  }
  return prisma.einvoiceNumberPool.create({
    data: {
      tenantId,
      yearMonth: data.yearMonth,
      trackAlpha: data.trackAlpha,
      rangeStart: data.rangeStart,
      rangeEnd: data.rangeEnd,
      nextNumber: data.rangeStart,
      note: data.note,
      createdBy: data.createdBy,
    },
  });
}

export async function updatePool(tenantId: string, id: string, data: { isActive?: boolean; note?: string | null }) {
  const existing = await prisma.einvoiceNumberPool.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('EinvoiceNumberPool', id);
  return prisma.einvoiceNumberPool.update({ where: { id }, data });
}

/**
 * Allocate the next invoice number from any active pool (FIFO by createdAt).
 * Uses an optimistic concurrency check: UPDATE ... WHERE nextNumber = expected.
 * If the row moved under us we retry; if all pools are exhausted we throw.
 */
async function allocateNumber(tenantId: string): Promise<{ poolId: string; trackAlpha: string; number: number }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const pool = await prisma.einvoiceNumberPool.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!pool) break;
    if (pool.nextNumber > pool.rangeEnd) {
      // Defensive: auto-deactivate exhausted pool and retry.
      await prisma.einvoiceNumberPool.update({ where: { id: pool.id }, data: { isActive: false } }).catch(() => {});
      continue;
    }
    const taken = pool.nextNumber;
    // Atomic increment guarded by nextNumber equality.
    const { count } = await prisma.einvoiceNumberPool.updateMany({
      where: { id: pool.id, nextNumber: taken },
      data: { nextNumber: taken + 1 },
    });
    if (count === 1) {
      // Auto-deactivate when just-incremented value exceeds the range.
      if (taken + 1 > pool.rangeEnd) {
        await prisma.einvoiceNumberPool.update({ where: { id: pool.id }, data: { isActive: false } }).catch(() => {});
      }
      return { poolId: pool.id, trackAlpha: pool.trackAlpha, number: taken };
    }
    // Race lost → retry.
  }
  throw new ValidationError('無可用配號區間（請先新增配號或重新啟用）');
}

function formatInvoiceNo(trackAlpha: string, number: number): string {
  return `${trackAlpha}${String(number).padStart(8, '0')}`;
}

function roundMoney(n: number): number {
  return Math.round(n);
}

// ----- issue -----

export async function issue(tenantId: string, input: IssueInput) {
  if (!input.items?.length) throw new ValidationError('至少需要一個品項');
  if (!input.buyerName?.trim()) throw new ValidationError('請填寫買受人名稱');
  if (input.buyerTaxId && !/^\d{8}$/.test(input.buyerTaxId.trim())) {
    throw new ValidationError('買受人統一編號應為 8 碼數字（B2C 可留空）');
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  const einvCfg = settings.einvoice;
  const sellerTaxId = einvCfg.sellerTaxId || tenant.taxId || '';
  const sellerName = einvCfg.sellerName || tenant.companyName;
  if (!/^\d{8}$/.test(sellerTaxId)) {
    throw new ValidationError('尚未設定公司統一編號（Tenant.taxId 或 settings.einvoice.sellerTaxId）');
  }
  if (!einvCfg.turnkeyInboundDir) {
    throw new ValidationError('尚未設定 Turnkey 匯入目錄（settings.einvoice.turnkeyInboundDir）');
  }

  // Optional linkage checks.
  if (input.receivableId) {
    const ar = await prisma.accountReceivable.findFirst({
      where: { id: input.receivableId, tenantId },
      include: { einvoice: true },
    });
    if (!ar) throw new NotFoundError('AccountReceivable', input.receivableId);
    if (ar.einvoice && ar.einvoice.status !== 'voided') {
      throw new ValidationError('此應收帳款已有有效電子發票');
    }
  }

  const now = new Date();
  const invoiceDate = input.invoiceDate ?? now;
  const taxType = input.taxType ?? einvCfg.defaultTaxType ?? '1';
  const taxRate = settings.taxRate;

  const preparedItems = input.items.map((it, idx) => {
    const amount = it.amount ?? roundMoney(it.quantity * it.unitPrice);
    return {
      sequence: it.sequence ?? idx + 1,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      amount,
    };
  });
  const salesAmount = preparedItems.reduce((s, it) => s + it.amount, 0);
  const taxAmount = taxType === '1' ? roundMoney(salesAmount * taxRate) : 0;
  const totalAmount = salesAmount + taxAmount;

  // Allocate BEFORE creating XML so filename / XML use the real number.
  const allocated = await allocateNumber(tenantId);
  const invoiceNo = formatInvoiceNo(allocated.trackAlpha, allocated.number);

  const xml = buildC0401({
    invoiceNo,
    invoiceDate,
    seller: { identifier: sellerTaxId, name: sellerName, address: tenant.address ?? undefined },
    buyer: {
      identifier: input.buyerTaxId?.trim() || null,
      name: input.buyerName.trim(),
      address: input.buyerAddress,
    },
    items: preparedItems,
    salesAmount,
    taxAmount,
    totalAmount,
    taxType,
    taxRate,
  });

  let xmlPath: string | null = null;
  try {
    const wrote = await writeIssueXml({ inboundDir: einvCfg.turnkeyInboundDir, invoiceNo, xml });
    xmlPath = wrote.absolutePath;
  } catch (err) {
    // If the write fails we intentionally keep the number allocated — the
    // number is already considered "used" and must not be reused per
    // 財政部 rules. We surface the error; ADMIN can retry from scratch.
    throw err instanceof Error ? err : new Error(String(err));
  }

  const created = await prisma.einvoice.create({
    data: {
      tenantId,
      invoiceNo,
      invoiceDate,
      buyerTaxId: input.buyerTaxId?.trim() || null,
      buyerName: input.buyerName.trim(),
      buyerAddress: input.buyerAddress,
      salesAmount,
      taxAmount,
      totalAmount,
      taxType,
      status: 'issued',
      xmlPath,
      receivableId: input.receivableId,
      salesOrderId: input.salesOrderId,
      createdBy: input.createdBy,
      items: {
        create: preparedItems.map((it) => ({
          sequence: it.sequence,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      },
    },
    include: { items: { orderBy: { sequence: 'asc' } } },
  });

  // Back-fill AR.invoiceNo so the existing AR list shows it.
  if (input.receivableId) {
    await prisma.accountReceivable.update({
      where: { id: input.receivableId },
      data: { invoiceNo },
    }).catch(() => { /* non-fatal */ });
  }

  if (input.createdBy) {
    await writeAudit({
      tenantId, userId: input.createdBy,
      action: 'EINVOICE_ISSUE', entity: 'Einvoice', entityId: created.id,
      detail: { invoiceNo, totalAmount, buyerTaxId: input.buyerTaxId ?? null },
    });
  }

  return created;
}

// ----- void -----

export async function voidInvoice(tenantId: string, id: string, reason: string, voidedBy?: string) {
  if (!reason?.trim()) throw new ValidationError('請填寫作廢原因');
  const inv = await prisma.einvoice.findFirst({ where: { id, tenantId } });
  if (!inv) throw new NotFoundError('Einvoice', id);
  if (inv.status === 'voided') throw new ValidationError('此發票已作廢');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  if (!settings.einvoice.turnkeyInboundDir) {
    throw new ValidationError('尚未設定 Turnkey 匯入目錄');
  }

  const voidDate = new Date();
  const xml = buildC0501({
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    voidDate,
    voidReason: reason.trim(),
  });
  const wrote = await writeVoidXml({
    inboundDir: settings.einvoice.turnkeyInboundDir,
    invoiceNo: inv.invoiceNo,
    xml,
  });

  const updated = await prisma.einvoice.update({
    where: { id },
    data: {
      status: 'voided',
      voidedAt: voidDate,
      voidReason: reason.trim(),
      voidXmlPath: wrote.absolutePath,
    },
  });

  // If this invoice was linked to an AR, clear the cached invoiceNo so the
  // AR list no longer surfaces a voided number as "the" invoice.
  if (inv.receivableId) {
    await prisma.accountReceivable.update({
      where: { id: inv.receivableId }, data: { invoiceNo: null },
    }).catch(() => {});
  }

  if (voidedBy) {
    await writeAudit({
      tenantId, userId: voidedBy,
      action: 'EINVOICE_VOID', entity: 'Einvoice', entityId: id,
      detail: { invoiceNo: inv.invoiceNo, reason: reason.trim() },
    });
  }

  return updated;
}

// ----- list / read -----

export async function list(tenantId: string, filters: {
  status?: string; salesOrderId?: string; receivableId?: string;
} = {}) {
  return prisma.einvoice.findMany({
    where: {
      tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      ...(filters.receivableId ? { receivableId: filters.receivableId } : {}),
    },
    include: {
      items: { orderBy: { sequence: 'asc' } },
      salesOrder: { select: { id: true, orderNo: true } },
      receivable: { select: { id: true } },
    },
    orderBy: { invoiceDate: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.einvoice.findFirst({
    where: { id, tenantId },
    include: {
      items: { orderBy: { sequence: 'asc' } },
      salesOrder: { select: { id: true, orderNo: true } },
      receivable: { select: { id: true } },
    },
  });
  if (!row) throw new NotFoundError('Einvoice', id);
  return row;
}

/** Read the raw C0401 / C0501 XML previously written to turnkeyInboundDir. */
export async function readXml(tenantId: string, id: string, kind: 'issue' | 'void'): Promise<string | null> {
  const row = await prisma.einvoice.findFirst({ where: { id, tenantId } });
  if (!row) throw new NotFoundError('Einvoice', id);
  const p = kind === 'issue' ? row.xmlPath : row.voidXmlPath;
  if (!p) return null;
  const { promises: fs } = await import('node:fs');
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}
