import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as receivableService from './receivable.service.js';

export const receivableRouter = Router();

const paySchema = z.object({
  paidDate: z.coerce.date().optional(),
  invoiceNo: z.string().optional(),
  note: z.string().optional(),
});

receivableRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isPaidParam = req.query.isPaid as string | undefined;
    const isPaid = isPaidParam === undefined ? undefined : isPaidParam === 'true';
    const customerId = req.query.customerId as string | undefined;
    const result = await receivableService.list(req.tenantId, { isPaid, customerId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

receivableRouter.get('/overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await receivableService.getOverdue(req.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

receivableRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await receivableService.getById(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

receivableRouter.post('/:id/pay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = paySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await receivableService.markPaid(req.tenantId, String(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
