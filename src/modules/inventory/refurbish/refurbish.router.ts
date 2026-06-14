import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as refurbishService from './refurbish.service.js';

export const refurbishRouter = Router();

const createSchema = z.object({
  usedMachineId: z.string().min(1),
  note: z.string().optional(),
});

const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
});

refurbishRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const rows = await refurbishService.list(req.tenantId, { status });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

refurbishRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await refurbishService.getById(req.tenantId, String(req.params.id));
    res.json(row);
  } catch (err) {
    next(err);
  }
});

refurbishRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const row = await refurbishService.create(req.tenantId, {
      ...parsed.data,
      createdBy: req.employee.id,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

refurbishRouter.post('/:id/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = addItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const item = await refurbishService.addItem(req.tenantId, String(req.params.id), {
      ...parsed.data,
      createdBy: req.employee.id,
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

refurbishRouter.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await refurbishService.complete(req.tenantId, String(req.params.id));
    res.json(row);
  } catch (err) {
    next(err);
  }
});

refurbishRouter.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await refurbishService.cancel(req.tenantId, String(req.params.id));
    res.json(row);
  } catch (err) {
    next(err);
  }
});
