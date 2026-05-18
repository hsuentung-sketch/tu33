import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import { recognizeBusinessCard } from '../../../ai/ocr.js';
import * as supplierService from './supplier.service.js';
import * as supplierDocService from './supplier-document.service.js';

export const supplierRouter = Router();

const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// 文件上傳（銀行存摺等）：記憶體緩衝，上限 10 MB。
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const SUPPLIER_DOC_TYPES = ['BANKBOOK', 'CONTRACT', 'OTHER'] as const;

// 匯款帳戶欄位（v2.14.0+），create / update 共用。
const bankFields = {
  bankCode: z.string().optional(),
  bankName: z.string().optional(),
  bankBranch: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountName: z.string().optional(),
};

// SALES 完全沒供應商權限（讀寫都擋）。
supplierRouter.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.employee?.role === 'SALES') return next(new ForbiddenError('沒權限：業務無供應商存取權'));
  next();
});

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
  ...bankFields,
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
  ...bankFields,
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

/**
 * 名片辨識上傳：multipart `file` → Vision OCR → 抽欄位 → 不寫資料。
 * 前端拿結果預填「新增供應商」modal。
 */
supplierRouter.post('/ocr',
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
        phone: card.phone ?? null,
        email: card.email ?? null,
        address: card.address ?? null,
        taxId: card.taxId ?? null,
        rawTextPreview: (card.rawText || '').slice(0, 300),
      });
    } catch (err) { next(err); }
  },
);

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

// -------- Supplier documents (銀行存摺 / 合約 / 其他) --------

supplierRouter.get(
  '/:id/documents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docs = await supplierDocService.list(req.tenantId, String(req.params.id));
      res.json(docs);
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.post(
  '/:id/documents',
  docUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) throw new ValidationError('缺少 file 欄位');
      const type = String(req.body?.type || '').toUpperCase();
      if (!SUPPLIER_DOC_TYPES.includes(type as (typeof SUPPLIER_DOC_TYPES)[number])) {
        throw new ValidationError(`type 必須為 ${SUPPLIER_DOC_TYPES.join(' / ')}`);
      }
      const doc = await supplierDocService.upload({
        tenantId: req.tenantId,
        supplierId: String(req.params.id),
        type: type as supplierDocService.SupplierDocumentType,
        fileName: file.originalname,
        mimeType: file.mimetype,
        bytes: file.buffer,
        uploadedBy: req.employee.id,
      });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.delete(
  '/:id/documents/:docId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await supplierDocService.remove(req.tenantId, String(req.params.docId));
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
