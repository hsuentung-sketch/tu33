import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as machineRecordService from './machine-record.service.js';

export const machineRecordRouter = Router();

const createSchema = z.object({
  productId: z.string().min(1),
  serialNumber: z.string().min(1),
  warrantyStartAt: z.coerce.date(),
  warrantyEndAt: z.coerce.date(),
  salesOrderId: z.string().optional(),
});

const updateSchema = z.object({
  serialNumber: z.string().min(1).optional(),
  warrantyStartAt: z.coerce.date().optional(),
  warrantyEndAt: z.coerce.date().optional(),
  salesOrderId: z.string().nullable().optional(),
});

machineRecordRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.query.productId as string | undefined;
    const warrantyStatus = req.query.warrantyStatus as 'active' | 'expiring' | 'expired' | undefined;
    const rows = await machineRecordService.list(req.tenantId, { productId, warrantyStatus });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

machineRecordRouter.get('/serial/:serialNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await machineRecordService.getBySerial(req.tenantId, String(req.params.serialNumber));
    if (!row) return res.status(404).json({ error: 'MachineRecord not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

machineRecordRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await machineRecordService.getById(req.tenantId, String(req.params.id));
    res.json(row);
  } catch (err) {
    next(err);
  }
});

machineRecordRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const row = await machineRecordService.create(req.tenantId, {
      ...parsed.data,
      registeredBy: req.employee.id,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

machineRecordRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const row = await machineRecordService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(row);
  } catch (err) {
    next(err);
  }
});
