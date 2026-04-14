import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as quotationService from './quotation.service.js';

export const quotationRouter = Router();

const itemSchema = z.object({
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  note: z.string().optional(),
  suggestedPrice: z.number().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  salesPerson: z.string().min(1),
  salesPhone: z.string().optional(),
  supplyTime: z.string().optional(),
  paymentTerms: z.string().optional(),
  validUntil: z.string().optional(),
  note: z.string().optional(),
  // createdBy is injected server-side from the authenticated employee.
  createdBy: z.string().min(1).optional(),
  items: z.array(itemSchema).min(1),
});

const updateSchema = z.object({
  salesPerson: z.string().min(1).optional(),
  salesPhone: z.string().optional(),
  supplyTime: z.string().optional(),
  paymentTerms: z.string().optional(),
  validUntil: z.string().optional(),
  note: z.string().optional(),
  trackingNote: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'TRACKING', 'WON', 'LOST', 'CANCELLED']),
  trackingNote: z.string().optional(),
  reason: z.string().optional(),
});

const convertSchema = z.object({
  createdBy: z.string().min(1),
});

quotationRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as
      | 'DRAFT'
      | 'SENT'
      | 'TRACKING'
      | 'WON'
      | 'LOST'
      | 'CANCELLED'
      | undefined;
    const customerId = req.query.customerId as string | undefined;
    const result = await quotationService.list(req.tenantId, { status, customerId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

quotationRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await quotationService.getById(req.tenantId, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

quotationRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const payload = { ...parsed.data, createdBy: parsed.data.createdBy ?? req.employee.id };
    const result = await quotationService.create(req.tenantId, payload);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

quotationRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await quotationService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

quotationRouter.post('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await quotationService.updateStatus(
      req.tenantId,
      String(req.params.id),
      parsed.data.status,
      { trackingNote: parsed.data.trackingNote, reason: parsed.data.reason },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

quotationRouter.post('/:id/convert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = convertSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await quotationService.convertToSalesOrder(
      req.tenantId,
      String(req.params.id),
      parsed.data.createdBy,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
