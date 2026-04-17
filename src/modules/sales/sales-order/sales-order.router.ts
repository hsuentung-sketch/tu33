import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import { prisma } from '../../../shared/prisma.js';
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
  customerId: z.string().min(1).optional(),
  salesPerson: z.string().min(1).optional(),
  salesPhone: z.string().nullable().optional(),
  deliveryNote: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  reason: z.string().optional(),
});

const deleteSchema = z.object({ reason: z.string().optional() });

async function assertCanEdit(tenantId: string, id: string, employee: { id: string; role: string }) {
  const o = await prisma.salesOrder.findFirst({
    where: { id, tenantId },
    select: { createdBy: true },
  });
  if (!o) throw new ValidationError('銷貨單不存在');
  if (employee.role !== 'ADMIN' && o.createdBy !== employee.id) {
    throw new ValidationError('⛔ 僅 ADMIN 或建單人可修改 / 刪除');
  }
}

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
    await assertCanEdit(req.tenantId, String(req.params.id), req.employee);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await salesOrderService.edit(req.tenantId, String(req.params.id), {
      ...parsed.data,
      editedBy: req.employee.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

salesOrderRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanEdit(req.tenantId, String(req.params.id), req.employee);
    const parsed = deleteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await salesOrderService.softDelete(
      req.tenantId, String(req.params.id), req.employee.id, parsed.data.reason,
    );
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
