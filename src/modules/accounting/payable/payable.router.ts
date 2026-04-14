import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as payableService from './payable.service.js';

export const payableRouter = Router();

const paySchema = z.object({
  paidDate: z.coerce.date().optional(),
  invoiceNo: z.string().optional(),
  note: z.string().optional(),
});

payableRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isPaidParam = req.query.isPaid as string | undefined;
    const isPaid = isPaidParam === undefined ? undefined : isPaidParam === 'true';
    const supplierId = req.query.supplierId as string | undefined;
    const result = await payableService.list(req.tenantId, { isPaid, supplierId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

payableRouter.get('/overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await payableService.getOverdue(req.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

payableRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await payableService.getById(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

payableRouter.post('/:id/pay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = paySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await payableService.markPaid(req.tenantId, String(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
