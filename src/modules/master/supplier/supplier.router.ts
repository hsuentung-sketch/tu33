import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as supplierService from './supplier.service.js';

export const supplierRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  contactName: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.number().int().nonnegative().optional(),
  email: z.string().email().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().optional(),
  contactName: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.number().int().nonnegative().optional(),
  email: z.string().email().optional(),
});

supplierRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const suppliers = await supplierService.list(req.tenantId, { includeInactive });
    res.json(suppliers);
  } catch (err) {
    next(err);
  }
});

supplierRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supplier = await supplierService.getById(req.tenantId, String(req.params.id));
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

supplierRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const supplier = await supplierService.create(req.tenantId, parsed.data);
    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

supplierRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const supplier = await supplierService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

supplierRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supplier = await supplierService.deactivate(req.tenantId, String(req.params.id));
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});
