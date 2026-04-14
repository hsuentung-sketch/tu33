import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as salesOrderService from './sales-order.service.js';

export const salesOrderRouter = Router();

const itemSchema = z.object({
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  note: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  salesPerson: z.string().min(1),
  salesPhone: z.string().optional(),
  deliveryNote: z.string().optional(),
  createdBy: z.string().min(1),
  items: z.array(itemSchema).min(1),
});

const updateSchema = z.object({
  salesPerson: z.string().min(1).optional(),
  salesPhone: z.string().optional(),
  deliveryNote: z.string().optional(),
});

const deliverSchema = z.object({
  deliveredBy: z.string().min(1),
  receivedBy: z.string().optional(),
});

salesOrderRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as 'PENDING' | 'DELIVERED' | 'COMPLETED' | undefined;
    const customerId = req.query.customerId as string | undefined;
    const result = await salesOrderService.list(req.tenantId, { status, customerId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

salesOrderRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await salesOrderService.getById(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

salesOrderRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await salesOrderService.create(req.tenantId, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

salesOrderRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await salesOrderService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

salesOrderRouter.post('/:id/deliver', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = deliverSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await salesOrderService.markDelivered(req.tenantId, String(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

salesOrderRouter.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await salesOrderService.complete(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});
