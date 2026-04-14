import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as purchaseOrderService from './purchase-order.service.js';

export const purchaseOrderRouter = Router();

const itemSchema = z.object({
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  note: z.string().optional(),
  referenceCost: z.number().nonnegative().optional(),
  lastPurchaseDate: z.coerce.date().optional(),
  sortOrder: z.number().int().optional(),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  internalStaff: z.string().min(1),
  staffPhone: z.string().optional(),
  deliveryNote: z.string().optional(),
  createdBy: z.string().min(1),
  items: z.array(itemSchema).min(1),
});

const updateSchema = z.object({
  internalStaff: z.string().min(1).optional(),
  staffPhone: z.string().optional(),
  deliveryNote: z.string().optional(),
});

purchaseOrderRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as 'PENDING' | 'RECEIVED' | 'COMPLETED' | undefined;
    const supplierId = req.query.supplierId as string | undefined;
    const result = await purchaseOrderService.list(req.tenantId, { status, supplierId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

purchaseOrderRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await purchaseOrderService.getById(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

purchaseOrderRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await purchaseOrderService.create(req.tenantId, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

purchaseOrderRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await purchaseOrderService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

purchaseOrderRouter.post('/:id/receive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await purchaseOrderService.markReceived(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

purchaseOrderRouter.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await purchaseOrderService.complete(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});
