/**
 * 快速費用登記 + 零用金調撥 router。
 * 掛在 /api/accounting/expense 之下；ACCOUNTING/ADMIN 角色（router 上層 guard）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as expenseService from './expense.service.js';

export const expenseRouter = Router();

const quickSchema = z.object({
  date: z.coerce.date(),
  description: z.string().min(1, '請填寫用途說明'),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'bank', 'payable']),
  expenseAccountId: z.string().optional(),
  voucherNo: z.string().optional(),
  status: z.enum(['pending', 'posted']).optional(),
});

const pettyCashSchema = z.object({
  date: z.coerce.date(),
  direction: z.enum(['withdraw', 'deposit']),
  amount: z.number().positive(),
  description: z.string().optional(),
});

expenseRouter.post('/quick', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = quickSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await expenseService.quickExpense(req.tenantId, req.employee?.id ?? null, parsed.data);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

expenseRouter.post('/petty-cash', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = pettyCashSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await expenseService.pettyCashTransfer(req.tenantId, req.employee?.id ?? null, parsed.data);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

/** 推測科目預覽（不建立任何資料）。前端輸入時動態呼叫顯示已判斷結果。 */
expenseRouter.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const desc = typeof req.query.description === 'string' ? req.query.description : '';
    const r = await expenseService.previewExpenseAccount(req.tenantId, desc);
    res.json(r);
  } catch (err) { next(err); }
});

/** 公開關鍵字規則（給前端顯示「為什麼判斷為此科目」說明）。 */
expenseRouter.get('/rules', async (_req: Request, res: Response) => {
  res.json(expenseService.getExpenseRules());
});
