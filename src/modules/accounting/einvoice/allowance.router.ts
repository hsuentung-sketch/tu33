import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import { requireAdmin } from '../../core/auth/require-admin.js';
import * as svc from './allowance.service.js';

export const allowanceRouter = Router();

const itemSchema = z.object({
  sequence: z.number().int().positive().optional(),
  originalSequence: z.number().int().positive().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  unitPrice: z.number().nonnegative(),
  amount: z.number().nonnegative().optional(),
  taxType: z.enum(['1', '2', '3']).optional(),
  taxAmount: z.number().nonnegative().optional(),
});

const issueSchema = z.object({
  invoiceId: z.string().min(1),
  items: z.array(itemSchema).min(1),
  reason: z.string().optional(),
  allowanceDate: z.coerce.date().optional(),
});

const voidSchema = z.object({ reason: z.string().min(1) });

allowanceRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = req.query.invoiceId ? String(req.query.invoiceId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json(await svc.listAllowances(req.tenantId, { invoiceId, status }));
  } catch (err) { next(err); }
});

allowanceRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getAllowance(req.tenantId, String(req.params.id)));
  } catch (err) { next(err); }
});

allowanceRouter.get('/:id/xml', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = req.query.kind === 'void' ? 'void' : 'issue';
    const xml = await svc.readAllowanceXml(req.tenantId, String(req.params.id), kind);
    if (xml == null) { res.status(404).send('XML not found'); return; }
    res.type('application/xml').send(xml);
  } catch (err) { next(err); }
});

allowanceRouter.post('/issue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可開立折讓單');
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const created = await svc.issueAllowance(req.tenantId, {
      ...parsed.data, createdBy: req.employee.id,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

allowanceRouter.post('/:id/void', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可作廢折讓單');
    const parsed = voidSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const voided = await svc.voidAllowance(
      req.tenantId, String(req.params.id), parsed.data.reason, req.employee.id,
    );
    res.json(voided);
  } catch (err) { next(err); }
});
