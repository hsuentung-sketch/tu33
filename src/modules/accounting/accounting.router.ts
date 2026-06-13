/**
 * 會計模組總路由（掛在 /api/accounting）。
 *
 * 含：activation / coa / period / journal / reports
 *
 * 所有端點需 ACCOUNTING+ 角色（含 ADMIN）。SALES / PURCHASING / VIEWER 一律擋。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, ForbiddenError } from '../../shared/errors.js';
import { requireRole } from '../core/auth/auth.middleware.js';
import { requireAdmin } from '../core/auth/require-admin.js';
import { prisma } from '../../shared/prisma.js';
import { getTenantSettings } from '../../shared/utils.js';
import * as activation from './activation.service.js';
import * as coaService from './coa/coa.service.js';
import * as periodService from './period/period.service.js';
import * as journalService from './journal/journal.service.js';
import * as reports from './reports.service.js';
import { expenseRouter } from './expense/expense.router.js';

export const accountingRouter = Router();

// 角色守門：ACCOUNTING / ADMIN 才可進
accountingRouter.use((req: Request, res: Response, next: NextFunction) => {
  const role = req.employee?.role;
  if (role !== 'ADMIN' && role !== 'ACCOUNTING') {
    return next(new ForbiddenError('需 ACCOUNTING 或 ADMIN 角色'));
  }
  next();
});

// 快速費用登記 + 零用金調撥（簡化 UI 抽象，內部產 JE）
accountingRouter.use('/expense', expenseRouter);

// ----- Activation / Settings -----

accountingRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const t = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    const cfg = getTenantSettings(t?.settings).accounting;
    res.json(cfg);
  } catch (err) { next(err); }
});

accountingRouter.post('/activate', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
        year: z.number().int().min(2000).max(2100).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      const result = await activation.activate(req.tenantId, parsed.data);
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
);

accountingRouter.post('/opening-balance', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        entryDate: z.coerce.date(),
        description: z.string().optional(),
        lines: z.array(z.object({
          accountCode: z.string(),
          debit: z.number().nonnegative().optional(),
          credit: z.number().nonnegative().optional(),
          description: z.string().optional(),
        })).min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      const e = await activation.createOpeningBalance(req.tenantId, req.employee.id, parsed.data);
      res.status(201).json(e);
    } catch (err) { next(err); }
  },
);

// ----- Chart of Accounts -----

accountingRouter.get('/coa', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const activeOnly = req.query.activeOnly === '1';
    res.json(await coaService.list(req.tenantId, { type, activeOnly }));
  } catch (err) { next(err); }
});

accountingRouter.post('/coa', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        code: z.string().regex(/^\d{4}$/, '科目編號需 4 位數字'),
        name: z.string().min(1),
        type: z.enum(['asset', 'liability', 'equity', 'income', 'cost', 'expense']),
        normalSide: z.enum(['debit', 'credit']),
        level: z.number().int().min(1).max(4).optional(),
        parentId: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      res.status(201).json(await coaService.create(req.tenantId, parsed.data));
    } catch (err) { next(err); }
  },
);

accountingRouter.put('/coa/:id', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      res.json(await coaService.update(req.tenantId, String(req.params.id), parsed.data));
    } catch (err) { next(err); }
  },
);

accountingRouter.delete('/coa/:id', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await coaService.remove(req.tenantId, String(req.params.id));
      res.status(204).end();
    } catch (err) { next(err); }
  },
);

// ----- Fiscal Periods -----

accountingRouter.get('/periods', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(await periodService.list(req.tenantId, { year }));
  } catch (err) { next(err); }
});

accountingRouter.post('/periods/ensure-year', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const year = Number(req.body?.year);
      const start = Number(req.body?.fiscalYearStartMonth ?? 1);
      if (!year) throw new ValidationError('year 必填');
      res.json(await periodService.ensureYearPeriods(req.tenantId, year, start));
    } catch (err) { next(err); }
  },
);

accountingRouter.post('/periods/:id/close', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await periodService.close(req.tenantId, String(req.params.id), req.employee.id));
    } catch (err) { next(err); }
  },
);

accountingRouter.post('/periods/:id/reopen', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await periodService.reopen(req.tenantId, String(req.params.id)));
    } catch (err) { next(err); }
  },
);

// ----- Journal Entries -----

accountingRouter.get('/journal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await journalService.list(req.tenantId, { status, periodId, source, from, to, limit }));
  } catch (err) { next(err); }
});

accountingRouter.get('/journal/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await journalService.getById(req.tenantId, String(req.params.id)));
  } catch (err) { next(err); }
});

accountingRouter.post('/journal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      entryDate: z.coerce.date(),
      description: z.string().min(1),
      source: z.string().optional(),
      sourceId: z.string().nullable().optional(),
      lines: z.array(z.object({
        accountId: z.string(),
        debit: z.number().nonnegative().optional(),
        credit: z.number().nonnegative().optional(),
        description: z.string().optional(),
        departmentId: z.string().nullable().optional(),
      })).min(2),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    res.status(201).json(await journalService.create(req.tenantId, req.employee.id, parsed.data));
  } catch (err) { next(err); }
});

accountingRouter.put('/journal/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      entryDate: z.coerce.date().optional(),
      description: z.string().min(1).optional(),
      lines: z.array(z.object({
        accountId: z.string(),
        debit: z.number().nonnegative().optional(),
        credit: z.number().nonnegative().optional(),
        description: z.string().optional(),
        departmentId: z.string().nullable().optional(),
      })).min(2).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    res.json(await journalService.update(req.tenantId, String(req.params.id), parsed.data));
  } catch (err) { next(err); }
});

accountingRouter.post('/journal/:id/post', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await journalService.post(req.tenantId, String(req.params.id), req.employee.id));
  } catch (err) { next(err); }
});

accountingRouter.post('/journal/:id/reverse', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      res.json(await journalService.reverse(req.tenantId, String(req.params.id), req.employee.id, reason));
    } catch (err) { next(err); }
  },
);

accountingRouter.patch('/journal/:id/vat-type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      vatDeductType: z.enum(['deductible', 'non_deductible', 'withholding', 'review']),
      vatInputAmount: z.number().nonnegative().optional(),
      deductibleVat: z.number().nonnegative().optional(),
      withholdingTax: z.number().nonnegative().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    res.json(await journalService.updateVatType(req.tenantId, String(req.params.id), parsed.data));
  } catch (err) { next(err); }
});

accountingRouter.delete('/journal/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await journalService.remove(req.tenantId, String(req.params.id));
    res.status(204).end();
  } catch (err) { next(err); }
});

// ----- Reports -----

accountingRouter.get('/reports/trial-balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    res.json(await reports.trialBalance(req.tenantId, { from, to }));
  } catch (err) { next(err); }
});

accountingRouter.get('/reports/income-statement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.query.from || !req.query.to) throw new ValidationError('from / to 必填');
    res.json(await reports.incomeStatement(
      req.tenantId,
      new Date(String(req.query.from)),
      new Date(String(req.query.to)),
    ));
  } catch (err) { next(err); }
});

accountingRouter.get('/reports/balance-sheet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date();
    res.json(await reports.balanceSheet(req.tenantId, asOf));
  } catch (err) { next(err); }
});

accountingRouter.get('/reports/general-ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.query.from || !req.query.to) throw new ValidationError('from / to 必填');
    const accountCode = typeof req.query.accountCode === 'string' ? req.query.accountCode : undefined;
    res.json(await reports.generalLedger(
      req.tenantId,
      new Date(String(req.query.from)),
      new Date(String(req.query.to)),
      accountCode,
    ));
  } catch (err) { next(err); }
});

accountingRouter.get('/reports/cash-flow', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.query.from || !req.query.to) throw new ValidationError('from / to 必填');
    res.json(await reports.cashFlowStatement(
      req.tenantId,
      new Date(String(req.query.from)),
      new Date(String(req.query.to)),
    ));
  } catch (err) { next(err); }
});

accountingRouter.get('/reports/ar-aging', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : undefined;
    res.json(await reports.arAging(req.tenantId, asOf));
  } catch (err) { next(err); }
});

accountingRouter.get('/reports/ap-aging', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : undefined;
    res.json(await reports.apAging(req.tenantId, asOf));
  } catch (err) { next(err); }
});

/**
 * 稅務扣抵報表
 * GET /api/accounting/reports/tax-deduction?year=2026&month=6
 * month 可省略（省略 = 整年）
 */
accountingRouter.get('/reports/tax-deduction', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? Number(req.query.month) : undefined;
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      res.status(400).json({ error: { message: '年份不合法' } }); return;
    }
    if (month !== undefined && (!Number.isFinite(month) || month < 1 || month > 12)) {
      res.status(400).json({ error: { message: '月份需介於 1~12' } }); return;
    }
    res.json(await reports.taxDeductionReport(req.tenantId, year, month));
  } catch (err) { next(err); }
});

/**
 * 零用金月結報表
 * GET /api/accounting/reports/petty-cash-monthly?year=2026&month=6
 */
accountingRouter.get('/reports/petty-cash-monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const year = req.query.year ? Number(req.query.year) : now.getFullYear();
    const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      res.status(400).json({ error: { message: '年份或月份不合法' } }); return;
    }
    res.json(await reports.pettyCashMonthly(req.tenantId, year, month));
  } catch (err) { next(err); }
});
