/**
 * 快速費用登記 + 零用金調撥 router。
 * 掛在 /api/accounting/expense 之下；ACCOUNTING/ADMIN 角色（router 上層 guard）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { ValidationError } from '../../../shared/errors.js';
import { recognizeInvoice } from '../../../ai/invoice-ocr.js';
import * as expenseService from './expense.service.js';

export const expenseRouter = Router();

// 後台拍照辨識上傳：5MB 上限（一般手機照片足夠）
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const quickSchema = z.object({
  date: z.coerce.date(),
  description: z.string().min(1, '請填寫用途說明'),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'bank', 'payable']),
  expenseAccountId: z.string().optional(),
  voucherNo: z.string().optional(),
  status: z.enum(['pending', 'posted']).optional(),
});

const pettyCashSchema = z.object({
  date: z.coerce.date(),
  direction: z.enum(['withdraw', 'deposit']),
  amount: z.number().positive(),
  description: z.string().optional(),
});

expenseRouter.post('/quick', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = quickSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await expenseService.quickExpense(req.tenantId, req.employee?.id ?? null, parsed.data);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

expenseRouter.post('/petty-cash', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = pettyCashSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await expenseService.pettyCashTransfer(req.tenantId, req.employee?.id ?? null, parsed.data);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

/** 推測科目預覽（不建立任何資料）。前端輸入時動態呼叫顯示已判斷結果。 */
expenseRouter.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const desc = typeof req.query.description === 'string' ? req.query.description : '';
    const r = await expenseService.previewExpenseAccount(req.tenantId, desc);
    res.json(r);
  } catch (err) { next(err); }
});

/** 公開關鍵字規則（給前端顯示「為什麼判斷為此科目」說明）。 */
expenseRouter.get('/rules', async (_req: Request, res: Response) => {
  res.json(expenseService.getExpenseRules());
});

/**
 * 後台拍照辨識上傳：multipart `file` 欄位 → 跑 invoice OCR → 回結構化結果。
 * 不寫入任何資料；前端拿結果預填快速費用登記 modal。
 *
 * 回傳格式：
 *  {
 *    merchantName, amount, invoiceDate (ISO yyyy-mm-dd), invoiceNo, merchantTaxId,
 *    inferred: { code, name, matchedKeyword },   // 推論的會計科目
 *    rawTextPreview                              // 原始辨識文字前 300 字（debug）
 *  }
 */
expenseRouter.post(
  '/ocr',
  ocrUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const f = (req as Request & { file?: Express.Multer.File }).file;
      if (!f) throw new ValidationError('未收到檔案（field name 必須是 file）');
      if (!/^image\/(jpe?g|png|heic|webp|gif)$/i.test(f.mimetype)) {
        throw new ValidationError(`不支援的檔案類型：${f.mimetype}（僅接受 jpg/png/heic/webp/gif）`);
      }
      const inv = await recognizeInvoice(f.buffer);
      // 順手做科目推論（用 description 欄位，缺則用商家名）
      const desc = inv.merchantName || '';
      let inferred: { code: string; name: string; matchedKeyword?: string | null } | null = null;
      if (desc) {
        try {
          const r = await expenseService.previewExpenseAccount(req.tenantId, desc);
          inferred = { code: r.code, name: r.name, matchedKeyword: r.matchedKeyword ?? null };
        } catch { /* 會計模組未啟用時忽略 */ }
      }
      res.json({
        merchantName: inv.merchantName ?? null,
        amount: inv.amount ?? null,
        invoiceDate: inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : null,
        invoiceNo: inv.invoiceNo ?? null,
        merchantTaxId: inv.merchantTaxId ?? null,
        inferred,
        rawTextPreview: (inv.rawText || '').slice(0, 300),
      });
    } catch (err) { next(err); }
  },
);
