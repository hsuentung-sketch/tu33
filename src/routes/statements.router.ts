import { Router, type Request, type Response, type NextFunction } from 'express';
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
