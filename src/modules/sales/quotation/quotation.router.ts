import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as quotationService from './quotation.service.js';
import { buildPdfShortUrl } from '../../../documents/pdf-shortlink.js';
import { prisma } from '../../../shared/prisma.js';
import { getLineClient } from '../../../line/client.js';
import { logger } from '../../../shared/logger.js';
import { writeErrorLog } from '../../../shared/error-log.js';

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
  customerId: z.string().min(1).optional(),
  salesPerson: z.string().min(1).optional(),
  salesPhone: z.string().nullable().optional(),
  supplyTime: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  reason: z.string().optional(),
});

const deleteSchema = z.object({
  reason: z.string().optional(),
});

async function assertCanEdit(tenantId: string, id: string, employee: { id: string; role: string }) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId },
    select: { createdBy: true, isDeleted: true },
  });
  if (!q) throw new ValidationError('報價單不存在');
  if (employee.role !== 'ADMIN' && q.createdBy !== employee.id) {
    throw new ValidationError('⛔ 僅 ADMIN 或建單人可修改 / 刪除');
  }
}

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
    const pdfUrl = await buildPdfShortUrl({
      tenantId: req.tenantId,
      kind: 'quotation',
      id: result.id,
      label: `quotation-${result.quotationNo}.pdf`,
      createdBy: req.employee.id,
    });

    // Push a LINE message with the PDF link. Best-effort: we already
    // have a persisted quotation and a usable JSON response, so any
    // push failure (missing token, user not linked, LINE API blip) is
    // logged but does not fail the request. Persists to ErrorLog so
    // ADMIN can see recurring push failures in the backend view.
    pushQuotationPdf(req.tenantId, req.employee.lineUserId, result.id, result.quotationNo, pdfUrl)
      .catch(async (err) => {
        logger.error('Quotation LINE push failed', { error: (err as Error).message, quotationId: result.id });
        await writeErrorLog({
          source: 'quotation.push-pdf',
          message: (err as Error).message,
          stack: (err as Error).stack ?? null,
          tenantId: req.tenantId,
          context: { quotationId: result.id, quotationNo: result.quotationNo },
        });
      });

    res.status(201).json({ ...result, pdfUrl });
  } catch (err) {
    next(err);
  }
});

quotationRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanEdit(req.tenantId, String(req.params.id), req.employee);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await quotationService.edit(req.tenantId, String(req.params.id), {
      ...parsed.data,
      editedBy: req.employee.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

quotationRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanEdit(req.tenantId, String(req.params.id), req.employee);
    const parsed = deleteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const result = await quotationService.softDelete(
      req.tenantId, String(req.params.id), req.employee.id, parsed.data.reason,
    );
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

/**
 * Push the quotation PDF link to the employee's LINE chat from the
 * tenant's bot. Called after successful LIFF submit so the user gets
 * the link in their normal LINE conversation, not just as a browser
 * alert. No-ops (with a log) if the employee isn't LINE-linked or the
 * tenant has no channel access token configured.
 */
async function pushQuotationPdf(
  tenantId: string,
  lineUserId: string | null,
  quotationId: string,
  quotationNo: string,
  pdfUrl: string,
): Promise<void> {
  if (!lineUserId) {
    logger.info('Skip LINE push: employee has no lineUserId', { tenantId });
    return;
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { lineAccessToken: true },
  });
  if (!tenant?.lineAccessToken) {
    logger.info('Skip LINE push: tenant has no lineAccessToken', { tenantId });
    return;
  }
  const client = getLineClient(tenant.lineAccessToken);
  await client.pushMessage({
    to: lineUserId,
    messages: [
      {
        type: 'text',
        text: `✅ 報價單已建立\n單號：${quotationNo}\n\n📄 quotation-${quotationNo}.pdf\n${pdfUrl}`,
      },
      {
        type: 'template',
        altText: '寄送 Email 給客戶？',
        template: {
          type: 'confirm',
          text: `要將此報價單以 Email 寄送給客戶嗎？`,
          actions: [
            { type: 'postback', label: '寄送', data: `action=quotation:email&id=${quotationId}` },
            { type: 'postback', label: '先不寄', data: 'action=quotation:email-skip' },
          ],
        },
      },
    ],
  });
}
