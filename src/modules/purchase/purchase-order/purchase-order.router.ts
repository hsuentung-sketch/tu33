import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import { prisma } from '../../../shared/prisma.js';
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
  supplierId: z.string().min(1).optional(),
  internalStaff: z.string().min(1).optional(),
  staffPhone: z.string().nullable().optional(),
  deliveryNote: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  reason: z.string().optional(),
});

const deleteSchema = z.object({ reason: z.string().optional() });

async function assertCanEdit(tenantId: string, id: string, employee: { id: string; role: string }) {
  const o = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId },
    select: { createdBy: true },
  });
  if (!o) throw new ValidationError('進貨單不存在');
  if (employee.role !== 'ADMIN' && o.createdBy !== employee.id) {
    throw new ValidationError('⛔ 僅 ADMIN 或建單人可修改 / 刪除');
  }
}

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
    await assertCanEdit(req.tenantId, String(req.params.id), req.employee);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await purchaseOrderService.edit(req.tenantId, String(req.params.id), {
      ...parsed.data,
      editedBy: req.employee.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

purchaseOrderRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanEdit(req.tenantId, String(req.params.id), req.employee);
    const parsed = deleteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await purchaseOrderService.softDelete(
      req.tenantId, String(req.params.id), req.employee.id, parsed.data.reason,
    );
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
