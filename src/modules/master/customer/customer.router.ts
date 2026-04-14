import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as customerService from './customer.service.js';

export const customerRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.number().int().nonnegative().optional(),
  lineUserId: z.string().optional(),
  email: z.string().email().optional(),
  grade: z.enum(['A', 'B', 'C']).optional(),
  tags: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  contactName: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.number().int().nonnegative().optional(),
  lineUserId: z.string().optional(),
  email: z.string().email().optional(),
  grade: z.enum(['A', 'B', 'C']).optional(),
  tags: z.array(z.string()).optional(),
});

customerRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, includeInactive } = req.query;
    if (typeof q === 'string' && q.length > 0) {
      const customers = await customerService.findByName(req.tenantId, q);
      return res.json(customers);
    }
    const customers = await customerService.list(req.tenantId, {
      includeInactive: includeInactive === 'true',
    });
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

customerRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await customerService.getById(req.tenantId, String(req.params.id));
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

customerRouter.get('/:id/payment-days', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await customerService.getPaymentDays(String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

customerRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const customer = await customerService.create(req.tenantId, parsed.data);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

customerRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const customer = await customerService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

customerRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await customerService.deactivate(req.tenantId, String(req.params.id));
    res.json(customer);
  } catch (err) {
    next(err);
  }
});
