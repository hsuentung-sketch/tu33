import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import { recognizeBusinessCard } from '../../../ai/ocr.js';
import * as customerService from './customer.service.js';
import * as salesOrderService from '../../sales/sales-order/sales-order.service.js';

export const customerRouter = Router();

const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const dayOfMonth = z.number().int().min(1).max(31).nullable().optional();
const paymentMethodEnum = z.enum(['check', 'cash', 'transfer']).nullable().optional();

// 匯款銀行資料（v2.14.0+）：客戶付款進來，僅供入帳對帳識別，存末五碼。
const bankFields = {
  bankCode: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountLast5: z.string().optional(),
};

const createSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  title: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.number().int().nonnegative().optional(),
  statementDay: dayOfMonth,
  fixedPaymentDay: dayOfMonth,
  paymentMethod: paymentMethodEnum,
  createdByEmployeeId: z.string().nullable().optional(),
  lineUserId: z.string().optional(),
  email: z.string().email().optional(),
  grade: z.enum(['A', 'B', 'C']).optional(),
  priceTier: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  ...bankFields,
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  contactName: z.string().optional(),
  title: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.number().int().nonnegative().optional(),
  statementDay: dayOfMonth,
  fixedPaymentDay: dayOfMonth,
  paymentMethod: paymentMethodEnum,
  createdByEmployeeId: z.string().nullable().optional(),
  lineUserId: z.string().optional(),
  email: z.string().email().optional(),
  grade: z.enum(['A', 'B', 'C']).optional(),
  priceTier: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  ...bankFields,
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

/** SALES guard: edit / delete only allowed if customer.createdBy is self or null. */
async function ensureSalesCanEdit(req: Request) {
  const me = req.employee;
  if (!me || me.role !== 'SALES') return;
  const c = await customerService.getById(req.tenantId, String(req.params.id));
  if (!customerService.canSalesAccessCustomer(c, me.id)) {
    throw new ForbiddenError('沒權限：只能修改自己建立的客戶');
  }
}

customerRouter.get('/:id/payment-days', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await customerService.getPaymentDays(String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

customerRouter.get('/:id/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10);
    const createdBy = req.employee?.role === 'SALES' ? req.employee.id : undefined;
    const result = await salesOrderService.listByCustomer(
      req.tenantId, String(req.params.id), { createdBy, page, pageSize },
    );
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
    // 若 body 帶 createdByEmployeeId（ADMIN 替別人指定業務）→ 用該值；
    // 否則 fallback 到當前登入者。SALES 自己建客戶會走 fallback。
    const ownerId = parsed.data.createdByEmployeeId ?? req.employee?.id ?? null;
    const customer = await customerService.create(req.tenantId, {
      ...parsed.data,
      createdByEmployeeId: ownerId,
      createdBy: ownerId ?? undefined,
    });
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

/**
 * 名片辨識上傳：multipart `file` → 跑 Google Vision OCR → 抽欄位 → 不寫資料。
 * 前端拿結果預填「新增客戶」modal。避開 LINE 拍照壓縮、可從電腦上傳原圖。
 */
customerRouter.post('/ocr',
  ocrUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const f = (req as Request & { file?: Express.Multer.File }).file;
      if (!f) throw new ValidationError('未收到檔案（field name 必須是 file）');
      if (!/^image\/(jpe?g|png|heic|webp|gif)$/i.test(f.mimetype)) {
        throw new ValidationError(`不支援的檔案類型：${f.mimetype}（僅接受 jpg/png/heic/webp/gif）`);
      }
      const card = await recognizeBusinessCard(f.buffer);
      res.json({
        companyName: card.companyName ?? null,
        contactName: card.contactName ?? null,
        title: card.title ?? null,
        phone: card.phone ?? null,
        email: card.email ?? null,
        address: card.address ?? null,
        taxId: card.taxId ?? null,
        rawTextPreview: (card.rawText || '').slice(0, 300),
      });
    } catch (err) { next(err); }
  },
);

customerRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureSalesCanEdit(req);
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
    await ensureSalesCanEdit(req);
    const customer = await customerService.deactivate(req.tenantId, String(req.params.id));
    res.json(customer);
  } catch (err) {
    next(err);
  }
});
