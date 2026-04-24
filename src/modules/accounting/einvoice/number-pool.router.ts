import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import { requireAdmin } from '../../core/auth/require-admin.js';
import * as einvoiceService from './einvoice.service.js';

export const einvoicePoolRouter = Router();

const createSchema = z.object({
  yearMonth: z.string().min(3),
  trackAlpha: z.string().length(2),
  rangeStart: z.number().int().nonnegative(),
  rangeEnd: z.number().int().positive(),
  note: z.string().optional(),
});

const updateSchema = z.object({
  isActive: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

einvoicePoolRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    res.json(await einvoiceService.listPools(req.tenantId, { includeInactive }));
  } catch (err) { next(err); }
});

einvoicePoolRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可維護配號');
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await einvoiceService.createPool(req.tenantId, {
      ...parsed.data,
      createdBy: req.employee.id,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

einvoicePoolRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可維護配號');
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const updated = await einvoiceService.updatePool(req.tenantId, String(req.params.id), parsed.data);
    res.json(updated);
  } catch (err) { next(err); }
});
