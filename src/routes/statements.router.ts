import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Readable } from 'node:stream';
import archiver from 'archiver';
import { requireRole } from '../modules/core/auth/auth.middleware.js';
import { runMonthlyStatements } from '../jobs/monthly-statement.js';
import { runDailyBackup } from '../jobs/daily-backup.js';
import { ValidationError, NotFoundError } from '../shared/errors.js';
import { prisma } from '../shared/prisma.js';
import { getTenantSettings } from '../shared/utils.js';
import { generateMonthlyInvoicePdf, generateMonthlyPayablePdf } from '../documents/pdf-generator.js';
import { logger } from '../shared/logger.js';

export const statementsRouter = Router();

/**
 * Internal helper：彙整單一客戶該月對帳單需要的 data。
 * 抽出來給「單張 PDF」與「批次 ZIP」共用。
 */
async function buildMonthlyInvoiceData(
  tenantId: string,
  customerId: string,
  year: number,
  month: number,
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });
  if (!customer) throw new NotFoundError('Customer', customerId);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);
  const companyHeader = settings.companyHeader || tenant?.companyName || '';

  const receivables = await prisma.accountReceivable.findMany({
    where: { tenantId, customerId, billingYear: year, billingMonth: month },
    include: {
      salesOrder: {
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  if (receivables.length === 0) return null;

  const rows: Array<{
    orderNo: string;
    orderDate: Date;
    productName: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    note: string | null;
  }> = [];
  let subtotal = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  let paidAmount = 0;
  let latestDue: Date | null = null;

  for (const ar of receivables) {
    const so = ar.salesOrder;
    if (!so) continue;
    for (const it of so.items) {
      rows.push({
        orderNo: so.orderNo,
        orderDate: so.orderDate,
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
        note: it.note,
      });
    }
    subtotal += Number(so.subtotal);
    taxAmount += Number(so.taxAmount);
    totalAmount += Number(so.totalAmount);
    if (ar.isPaid) paidAmount += Number(ar.amount);
    if (!latestDue || ar.dueDate > latestDue) latestDue = ar.dueDate;
  }

  const unpaidAll = await prisma.accountReceivable.findMany({
    where: { tenantId, customerId, isPaid: false },
    select: { billingYear: true, billingMonth: true, amount: true },
  });
  const unpaidMap = new Map<string, number>();
  for (const ar of unpaidAll) {
    const key = `${ar.billingYear}/${String(ar.billingMonth).padStart(2, '0')}`;
    unpaidMap.set(key, (unpaidMap.get(key) ?? 0) + Number(ar.amount));
  }
  const unpaidPeriods = [...unpaidMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, amount]) => ({ period, amount }));

  return {
    tenant,
    customer,
    companyHeader,
    settings,
    rows,
    subtotal,
    taxAmount,
    totalAmount,
    paidAmount,
    latestDue,
    unpaidPeriods,
  };
}

/**
 * Manual backup trigger — ADMIN only. Useful for verifying the job
 * works right after deploy and any time the admin wants an ad-hoc copy.
 */
statementsRouter.post(
  '/backup',
  requireRole('ADMIN'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await runDailyBackup();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

statementsRouter.post(
  '/run',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { year, month } = req.body ?? {};
      if (
        typeof year !== 'number' ||
        typeof month !== 'number' ||
        month < 1 ||
        month > 12
      ) {
        throw new ValidationError('year and month are required (month 1-12)');
      }
      await runMonthlyStatements(year, month, req.tenantId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 列出當月有未付 AR 的客戶（給後台帳款頁的「批次月結帳單」用）。
 * GET /api/statements/monthly-invoice/unpaid-customers?year=YYYY&month=M
 * 回傳：{ year, month, customerCount, totalUnpaid, items: [{ customerId, customerName,
 *   unpaidAmount, arCount, oldestDueDate }] }
 *
 * 「有欠款」= AR 的 billingYear/billingMonth 等於指定月，且 isPaid=false。
 * 排序：未付金額降冪。
 */
statementsRouter.get(
  '/monthly-invoice/unpaid-customers',
  requireRole('ADMIN', 'ACCOUNTING'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const year = parseInt(String(req.query.year ?? ''), 10);
      const month = parseInt(String(req.query.month ?? ''), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new ValidationError('year, month are required (month 1-12)');
      }
      const ars = await prisma.accountReceivable.findMany({
        where: {
          tenantId: req.tenantId,
          billingYear: year,
          billingMonth: month,
          isPaid: false,
        },
        select: {
          customerId: true,
          amount: true,
          dueDate: true,
          customer: { select: { id: true, name: true } },
        },
      });
      const map = new Map<string, {
        customerId: string;
        customerName: string;
        unpaidAmount: number;
        arCount: number;
        oldestDueDate: Date;
      }>();
      for (const ar of ars) {
        const cid = ar.customerId;
        const existing = map.get(cid);
        if (existing) {
          existing.unpaidAmount += Number(ar.amount);
          existing.arCount += 1;
          if (ar.dueDate < existing.oldestDueDate) existing.oldestDueDate = ar.dueDate;
        } else {
          map.set(cid, {
            customerId: cid,
            customerName: ar.customer?.name ?? '(未知)',
            unpaidAmount: Number(ar.amount),
            arCount: 1,
            oldestDueDate: ar.dueDate,
          });
        }
      }
      const items = [...map.values()].sort((a, b) => b.unpaidAmount - a.unpaidAmount);
      res.json({
        year,
        month,
        customerCount: items.length,
        totalUnpaid: items.reduce((s, r) => s + r.unpaidAmount, 0),
        items,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 批次下載：當月有未付 AR 的客戶之月結請款單，打包為 ZIP。
 * GET /api/statements/monthly-invoice/batch.zip?year=YYYY&month=M
 *
 * ZIP 內每客戶一份 PDF，檔名：`{客戶名}-YYYYMM.pdf`
 * 若某客戶 PDF 產生失敗，logger 記錄並跳過該客戶，不中斷整個 ZIP。
 */
statementsRouter.get(
  '/monthly-invoice/batch.zip',
  requireRole('ADMIN', 'ACCOUNTING'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const year = parseInt(String(req.query.year ?? ''), 10);
      const month = parseInt(String(req.query.month ?? ''), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new ValidationError('year, month are required (month 1-12)');
      }
      const unpaidArs = await prisma.accountReceivable.findMany({
        where: {
          tenantId: req.tenantId,
          billingYear: year,
          billingMonth: month,
          isPaid: false,
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });
      const customerIds = [...new Set(unpaidArs.map((a) => a.customerId))];
      if (customerIds.length === 0) {
        res.status(404).json({ error: `${year}/${month} 沒有任何未付請款` });
        return;
      }
      const period = `${year}${String(month).padStart(2, '0')}`;
      const zipName = `monthly-invoices-${period}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => {
        logger.error('batch invoice zip error', { error: err.message });
        if (!res.headersSent) next(err); else res.end();
      });
      archive.pipe(res);

      const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });

      for (const customerId of customerIds) {
        try {
          const data = await buildMonthlyInvoiceData(req.tenantId, customerId, year, month);
          if (!data) continue;
          const doc = generateMonthlyInvoicePdf({
            companyHeader: data.companyHeader,
            companyTaxId: tenant?.taxId ?? null,
            companyPhone: tenant?.phone ?? null,
            companyAddress: tenant?.address ?? null,
            period: `${year}/${String(month).padStart(2, '0')}`,
            dueDate: data.latestDue,
            customer: {
              name: data.customer.name,
              contactName: data.customer.contactName,
              taxId: data.customer.taxId,
              phone: data.customer.phone,
              address: data.customer.address,
            },
            rows: data.rows,
            subtotal: data.subtotal,
            taxAmount: data.taxAmount,
            totalAmount: data.totalAmount,
            paidAmount: data.paidAmount,
            unpaidPeriods: data.unpaidPeriods,
            pdfFooter: data.settings.pdfFooter,
          });
          const safeName = data.customer.name.replace(/[^\w一-鿿-]/g, '_');
          archive.append(doc as unknown as Readable, { name: `${safeName}-${period}.pdf` });
          doc.end();
        } catch (perCustomerErr) {
          logger.error('batch invoice: skip customer', {
            customerId,
            error: (perCustomerErr as Error).message,
          });
        }
      }
      await archive.finalize();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 月結請款單 PDF — 單一客戶該月所有銷貨彙整（品項層級）。
 * GET /api/statements/monthly-invoice/:customerId/:year/:month
 * ADMIN / ACCOUNTING 限定。
 */
statementsRouter.get(
  '/monthly-invoice/:customerId/:year/:month',
  requireRole('ADMIN', 'ACCOUNTING'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = String(req.params.customerId);
      const year = parseInt(String(req.params.year), 10);
      const month = parseInt(String(req.params.month), 10);
      if (!customerId || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new ValidationError('customerId, year, month are required (month 1-12)');
      }

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId: req.tenantId },
      });
      if (!customer) throw new NotFoundError('Customer', customerId);

      const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      const settings = getTenantSettings(tenant?.settings);
      const companyHeader = settings.companyHeader || tenant?.companyName || '';

      // Gather receivables for this (customer, period) and expand their
      // linked sales orders into per-item rows.
      const receivables = await prisma.accountReceivable.findMany({
        where: { tenantId: req.tenantId, customerId, billingYear: year, billingMonth: month },
        include: {
          salesOrder: {
            include: { items: { orderBy: { sortOrder: 'asc' } } },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      if (receivables.length === 0) {
        res.status(404).json({ error: `該客戶 ${year}/${month} 無應收帳款紀錄` });
        return;
      }

      const rows: Array<{
        orderNo: string;
        orderDate: Date;
        productName: string;
        quantity: number;
        unitPrice: number;
        amount: number;
        note: string | null;
      }> = [];
      let subtotal = 0;
      let taxAmount = 0;
      let totalAmount = 0;
      let paidAmount = 0;
      let latestDue: Date | null = null;

      for (const ar of receivables) {
        const so = ar.salesOrder;
        if (!so) continue;
        for (const it of so.items) {
          rows.push({
            orderNo: so.orderNo,
            orderDate: so.orderDate,
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: Number(it.unitPrice),
            amount: Number(it.amount),
            note: it.note,
          });
        }
        subtotal += Number(so.subtotal);
        taxAmount += Number(so.taxAmount);
        totalAmount += Number(so.totalAmount);
        if (ar.isPaid) paidAmount += Number(ar.amount);
        if (!latestDue || ar.dueDate > latestDue) latestDue = ar.dueDate;
      }

      // Collect ALL unpaid periods for this customer (includes current).
      const unpaidAll = await prisma.accountReceivable.findMany({
        where: { tenantId: req.tenantId, customerId, isPaid: false },
        select: { billingYear: true, billingMonth: true, amount: true },
      });
      // Group by (year, month) so a single period sums multiple SO's.
      const unpaidMap = new Map<string, number>();
      for (const ar of unpaidAll) {
        const key = `${ar.billingYear}/${String(ar.billingMonth).padStart(2, '0')}`;
        unpaidMap.set(key, (unpaidMap.get(key) ?? 0) + Number(ar.amount));
      }
      const unpaidPeriods = [...unpaidMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, amount]) => ({ period, amount }));

      const period = `${year}/${String(month).padStart(2, '0')}`;
      const filename = `invoice-${customer.name.replace(/[^\w\u4e00-\u9fff-]/g, '_')}-${period.replace('/', '')}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);

      try {
        const doc = generateMonthlyInvoicePdf({
          companyHeader,
          companyTaxId: tenant?.taxId ?? null,
          companyPhone: tenant?.phone ?? null,
          companyAddress: tenant?.address ?? null,
          period,
          dueDate: latestDue,
          customer: {
            name: customer.name,
            contactName: customer.contactName,
            taxId: customer.taxId,
            phone: customer.phone,
            address: customer.address,
          },
          rows,
          subtotal,
          taxAmount,
          totalAmount,
          paidAmount,
          unpaidPeriods,
          pdfFooter: settings.pdfFooter,
        });
        doc.on('error', (err) => {
          logger.error('monthly-invoice pdf error', { error: (err as Error).message });
          if (!res.headersSent) next(err); else res.end();
        });
        doc.pipe(res);
        doc.end();
      } catch (err) {
        logger.error('monthly-invoice generate failed', { error: (err as Error).message });
        if (!res.headersSent) next(err);
      }
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 月結應付對帳單 PDF — 單一供應商該月所有進貨彙整（品項層級）。
 * GET /api/statements/monthly-payable/:supplierId/:year/:month
 */
statementsRouter.get(
  '/monthly-payable/:supplierId/:year/:month',
  requireRole('ADMIN', 'ACCOUNTING'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supplierId = String(req.params.supplierId);
      const year = parseInt(String(req.params.year), 10);
      const month = parseInt(String(req.params.month), 10);
      if (!supplierId || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new ValidationError('supplierId, year, month are required (month 1-12)');
      }

      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, tenantId: req.tenantId },
      });
      if (!supplier) throw new NotFoundError('Supplier', supplierId);

      const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      const settings = getTenantSettings(tenant?.settings);
      const companyHeader = settings.companyHeader || tenant?.companyName || '';

      const payables = await prisma.accountPayable.findMany({
        where: { tenantId: req.tenantId, supplierId, billingYear: year, billingMonth: month },
        include: {
          purchaseOrder: {
            include: { items: { orderBy: { sortOrder: 'asc' } } },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      if (payables.length === 0) {
        res.status(404).json({ error: `該供應商 ${year}/${month} 無應付帳款紀錄` });
        return;
      }

      const rows: Array<{
        orderNo: string;
        orderDate: Date;
        productName: string;
        quantity: number;
        unitPrice: number;
        amount: number;
        note: string | null;
      }> = [];
      let subtotal = 0;
      let taxAmount = 0;
      let totalAmount = 0;
      let paidAmount = 0;
      let latestDue: Date | null = null;

      for (const ap of payables) {
        const po = ap.purchaseOrder;
        if (!po) continue;
        for (const it of po.items) {
          rows.push({
            orderNo: po.orderNo,
            orderDate: po.orderDate,
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: Number(it.unitPrice),
            amount: Number(it.amount),
            note: it.note,
          });
        }
        subtotal += Number(po.subtotal);
        taxAmount += Number(po.taxAmount);
        totalAmount += Number(po.totalAmount);
        if (ap.isPaid) paidAmount += Number(ap.amount);
        if (!latestDue || ap.dueDate > latestDue) latestDue = ap.dueDate;
      }

      // All unpaid periods for this supplier
      const unpaidAll = await prisma.accountPayable.findMany({
        where: { tenantId: req.tenantId, supplierId, isPaid: false },
        select: { billingYear: true, billingMonth: true, amount: true },
      });
      const unpaidMap = new Map<string, number>();
      for (const ap of unpaidAll) {
        const key = `${ap.billingYear}/${String(ap.billingMonth).padStart(2, '0')}`;
        unpaidMap.set(key, (unpaidMap.get(key) ?? 0) + Number(ap.amount));
      }
      const unpaidPeriods = [...unpaidMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, amount]) => ({ period, amount }));

      const period = `${year}/${String(month).padStart(2, '0')}`;
      const filename = `payable-${supplier.name.replace(/[^\w\u4e00-\u9fff-]/g, '_')}-${period.replace('/', '')}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);

      try {
        const doc = generateMonthlyPayablePdf({
          companyHeader,
          companyTaxId: tenant?.taxId ?? null,
          companyPhone: tenant?.phone ?? null,
          companyAddress: tenant?.address ?? null,
          period,
          dueDate: latestDue,
          supplier: {
            name: supplier.name,
            contactName: supplier.contactName,
            taxId: supplier.taxId,
            phone: supplier.phone,
            address: supplier.address,
          },
          rows,
          subtotal,
          taxAmount,
          totalAmount,
          paidAmount,
          unpaidPeriods,
          pdfFooter: settings.pdfFooter,
        });
        doc.on('error', (err) => {
          logger.error('monthly-payable pdf error', { error: (err as Error).message });
          if (!res.headersSent) next(err); else res.end();
        });
        doc.pipe(res);
        doc.end();
      } catch (err) {
        logger.error('monthly-payable generate failed', { error: (err as Error).message });
        if (!res.headersSent) next(err);
      }
    } catch (err) {
      next(err);
    }
  },
);
