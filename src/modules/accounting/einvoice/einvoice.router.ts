import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import { requireAdmin } from '../../core/auth/require-admin.js';
import * as einvoiceService from './einvoice.service.js';

export const einvoiceRouter = Router();

const itemSchema = z.object({
  sequence: z.number().int().positive().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  unitPrice: z.number().nonnegative(),
  amount: z.number().nonnegative().optional(),
});

const issueSchema = z.object({
  receivableId: z.string().optional(),
  salesOrderId: z.string().optional(),
  buyerTaxId: z.string().nullable().optional(),
  buyerName: z.string().min(1, '請填寫買受人名稱'),
  buyerAddress: z.string().optional(),
  items: z.array(itemSchema).min(1, '至少一個品項'),
  taxType: z.enum(['1', '2', '3']).optional(),
  invoiceDate: z.coerce.date().optional(),
});

const voidSchema = z.object({
  reason: z.string().min(1, '請填寫作廢原因'),
});

einvoiceRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const salesOrderId = req.query.salesOrderId ? String(req.query.salesOrderId) : undefined;
    const receivableId = req.query.receivableId ? String(req.query.receivableId) : undefined;
    res.json(await einvoiceService.list(req.tenantId, { status, salesOrderId, receivableId }));
  } catch (err) { next(err); }
});

einvoiceRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await einvoiceService.getById(req.tenantId, String(req.params.id)));
  } catch (err) { next(err); }
});

einvoiceRouter.get('/:id/xml', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = req.query.kind === 'void' ? 'void' : 'issue';
    const xml = await einvoiceService.readXml(req.tenantId, String(req.params.id), kind);
    if (xml == null) {
      res.status(404).send('XML not found');
      return;
    }
    res.type('application/xml').send(xml);
  } catch (err) { next(err); }
});

einvoiceRouter.post('/issue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可開立電子發票');
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await einvoiceService.issue(req.tenantId, {
      ...parsed.data,
      createdBy: req.employee.id,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

einvoiceRouter.post('/:id/void', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可作廢電子發票');
    const parsed = voidSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const voided = await einvoiceService.voidInvoice(
      req.tenantId, String(req.params.id), parsed.data.reason, req.employee.id,
    );
    res.json(voided);
  } catch (err) { next(err); }
});
