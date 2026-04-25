import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { getTenantSettings, generateDocumentNo } from '../../../shared/utils.js';
import { writeAudit } from '../../../shared/audit.js';
import { buildD0401, buildD0501 } from './xml-builder.js';
import { writeIssueXml, writeVoidXml } from './turnkey-writer.js';

export interface AllowanceItemInput {
  sequence?: number;
  originalSequence?: number;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount?: number;
  taxType?: string;
  taxAmount?: number;
}

export interface IssueAllowanceInput {
  invoiceId: string;
  items: AllowanceItemInput[];
  reason?: string;
  allowanceDate?: Date;
  createdBy?: string;
}

function roundMoney(n: number) {
  return Math.round(n);
}

async function nextAllowanceNo(tenantId: string, date: Date): Promise<string> {
  // Simple per-day counter scoped per tenant.
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setHours(23, 59, 59, 999);
  const count = await prisma.einvoiceAllowance.count({
    where: { tenantId, createdAt: { gte: start, lte: end } },
  });
  return 'AL' + generateDocumentNo(date, count + 1);
}

export async function issueAllowance(tenantId: string, input: IssueAllowanceInput) {
  if (!input.items?.length) throw new ValidationError('至少需要一個折讓品項');
  const inv = await prisma.einvoice.findFirst({
    where: { id: input.invoiceId, tenantId },
    include: { items: { orderBy: { sequence: 'asc' } } },
  });
  if (!inv) throw new NotFoundError('Einvoice', input.invoiceId);
  if (inv.status === 'voided') throw new ValidationError('原發票已作廢，不可折讓');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  const einvCfg = settings.einvoice;
  const sellerTaxId = einvCfg.sellerTaxId || tenant.taxId || '';
  const sellerName = einvCfg.sellerName || tenant.companyName;
  if (!einvCfg.turnkeyInboundDir) throw new ValidationError('尚未設定 Turnkey 匯入目錄');

  const taxRate = settings.taxRate;
  const now = new Date();
  const allowanceDate = input.allowanceDate ?? now;

  const prepared = input.items.map((it, idx) => {
    const amount = it.amount ?? roundMoney(it.quantity * it.unitPrice);
    const taxType = it.taxType ?? inv.taxType ?? '1';
    const taxAmount = it.taxAmount ?? (taxType === '1' ? roundMoney(amount * taxRate) : 0);
    return {
      sequence: it.sequence ?? idx + 1,
      originalSequence: it.originalSequence,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      amount,
      taxType,
      taxAmount,
    };
  });
  const salesAmount = prepared.reduce((s, it) => s + it.amount, 0);
  const taxAmount = prepared.reduce((s, it) => s + it.taxAmount, 0);
  const totalAmount = salesAmount + taxAmount;

  if (totalAmount > Number(inv.totalAmount)) {
    throw new ValidationError('折讓總額超過原發票金額');
  }

  const allowanceNo = await nextAllowanceNo(tenantId, allowanceDate);

  const xml = buildD0401({
    allowanceNo,
    allowanceDate,
    seller: { identifier: sellerTaxId, name: sellerName },
    buyer: { identifier: inv.buyerTaxId, name: inv.buyerName, address: inv.buyerAddress ?? undefined },
    originalInvoiceNo: inv.invoiceNo,
    originalInvoiceDate: inv.invoiceDate,
    items: prepared,
    salesAmount,
    taxAmount,
    totalAmount,
  });

  const wrote = await writeIssueXml({
    inboundDir: einvCfg.turnkeyInboundDir,
    invoiceNo: allowanceNo,
    xml,
  });

  const row = await prisma.einvoiceAllowance.create({
    data: {
      tenantId,
      allowanceNo,
      allowanceDate,
      type: 'seller',
      invoiceId: inv.id,
      salesAmount,
      taxAmount,
      totalAmount,
      reason: input.reason,
      status: 'issued',
      xmlPath: wrote.absolutePath,
      createdBy: input.createdBy,
      items: {
        create: prepared.map((it) => ({
          sequence: it.sequence,
          originalSequence: it.originalSequence,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          amount: it.amount,
          taxType: it.taxType,
          taxAmount: it.taxAmount,
        })),
      },
    },
    include: { items: { orderBy: { sequence: 'asc' } } },
  });

  if (input.createdBy) {
    await writeAudit({
      tenantId, userId: input.createdBy,
      action: 'EINVOICE_ALLOWANCE_ISSUE', entity: 'EinvoiceAllowance', entityId: row.id,
      detail: { allowanceNo, totalAmount, invoiceNo: inv.invoiceNo },
    });
  }
  return row;
}

export async function voidAllowance(tenantId: string, id: string, reason: string, voidedBy?: string) {
  if (!reason?.trim()) throw new ValidationError('請填寫作廢原因');
  const row = await prisma.einvoiceAllowance.findFirst({
    where: { id, tenantId },
    include: { invoice: true },
  });
  if (!row) throw new NotFoundError('EinvoiceAllowance', id);
  if (row.status === 'voided') throw new ValidationError('此折讓單已作廢');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  const einvCfg = settings.einvoice;
  if (!einvCfg.turnkeyInboundDir) throw new ValidationError('尚未設定 Turnkey 匯入目錄');

  const sellerTaxId = einvCfg.sellerTaxId || tenant.taxId || '';
  const sellerName = einvCfg.sellerName || tenant.companyName;
  const voidDate = new Date();
  const xml = buildD0501({
    allowanceNo: row.allowanceNo,
    allowanceDate: row.allowanceDate,
    voidDate,
    voidReason: reason.trim(),
    seller: { identifier: sellerTaxId, name: sellerName },
    buyer: { identifier: row.invoice.buyerTaxId, name: row.invoice.buyerName },
  });
  const wrote = await writeVoidXml({
    inboundDir: einvCfg.turnkeyInboundDir,
    invoiceNo: row.allowanceNo,
    xml,
  });

  const updated = await prisma.einvoiceAllowance.update({
    where: { id },
    data: {
      status: 'voided',
      voidedAt: voidDate,
      voidReason: reason.trim(),
      voidXmlPath: wrote.absolutePath,
    },
  });

  if (voidedBy) {
    await writeAudit({
      tenantId, userId: voidedBy,
      action: 'EINVOICE_ALLOWANCE_VOID', entity: 'EinvoiceAllowance', entityId: id,
      detail: { allowanceNo: row.allowanceNo, reason: reason.trim() },
    });
  }
  return updated;
}

export async function listAllowances(tenantId: string, filters: { invoiceId?: string; status?: string } = {}) {
  return prisma.einvoiceAllowance.findMany({
    where: {
      tenantId,
      ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      items: { orderBy: { sequence: 'asc' } },
      invoice: { select: { id: true, invoiceNo: true, invoiceDate: true, buyerName: true } },
    },
    orderBy: { allowanceDate: 'desc' },
  });
}

export async function getAllowance(tenantId: string, id: string) {
  const row = await prisma.einvoiceAllowance.findFirst({
    where: { id, tenantId },
    include: {
      items: { orderBy: { sequence: 'asc' } },
      invoice: true,
    },
  });
  if (!row) throw new NotFoundError('EinvoiceAllowance', id);
  return row;
}

export async function readAllowanceXml(tenantId: string, id: string, kind: 'issue' | 'void'): Promise<string | null> {
  const row = await prisma.einvoiceAllowance.findFirst({ where: { id, tenantId } });
  if (!row) throw new NotFoundError('EinvoiceAllowance', id);
  const p = kind === 'issue' ? row.xmlPath : row.voidXmlPath;
  if (!p) return null;
  const { promises: fs } = await import('node:fs');
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}
