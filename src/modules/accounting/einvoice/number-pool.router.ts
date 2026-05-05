import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { ValidationError } from '../../../shared/errors.js';
import { requireAdmin } from '../../core/auth/require-admin.js';
import * as einvoiceService from './einvoice.service.js';

export const einvoicePoolRouter = Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1MB（平台 CSV 通常數 KB）
});

const createSchema = z.object({
  // 期別 7 碼：民國年(3) + 單月(2) + 雙月(2)，如 "1131112"
  yearMonth: z.string().regex(/^\d{7}$/, '期別須為 7 碼數字（民國年 3 碼 + 單月 2 碼 + 雙月 2 碼，如 1131112）'),
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

/**
 * 匯入整合服務平台下發的配號 CSV。
 * Field name: file (multipart). 預期 UTF-8（會自動 strip BOM）。
 */
einvoicePoolRouter.post(
  '/import-csv',
  csvUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req, '僅 ADMIN 可匯入配號');
      const f = (req as Request & { file?: Express.Multer.File }).file;
      if (!f) throw new ValidationError('未收到檔案（field name 必須是 file）');
      const text = f.buffer.toString('utf8');
      const result = await einvoiceService.importPoolsCsv(req.tenantId, text, req.employee.id);
      res.json(result);
    } catch (err) { next(err); }
  },
);

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
