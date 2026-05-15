/**
 * Tenant self-service API — 公司資料（後台可改的那些欄位）。
 *
 * GET  /api/tenant/me     — 任何登入者可讀
 * PUT  /api/tenant/me     — ADMIN 限定
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { prisma } from '../../../shared/prisma.js';
import { ValidationError } from '../../../shared/errors.js';
import { requireRole } from '../auth/auth.middleware.js';
import { getTenantSettings } from '../../../shared/utils.js';

export const tenantRouter = Router();

/** 發票章圖檔目錄。Fly volume mount 在 /data；本機 dev fallback 到 ./data/stamps */
const STAMP_DIR = process.env.STAMP_DIR
  || (existsSync('/data') ? '/data/stamps' : resolve(process.cwd(), 'data/stamps'));

export function stampPathFor(tenantId: string): string {
  return resolve(STAMP_DIR, `${tenantId}.png`);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

const updateSchema = z.object({
  companyName: z.string().min(1).optional(),
  taxId: z.string().max(20).nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  logo: z.string().nullable().optional(),
});

const einvoiceSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  // sellerTaxId / sellerName / sellerAddress 已停用：賣方資訊一律從「公司資料」
  // (Tenant.companyName / taxId / address) 取得，避免使用者誤填造成 XML 錯誤。
  // schema 仍接受這些欄位但會直接忽略，保留向後相容。
  sellerTaxId: z.string().optional(),
  sellerName: z.string().optional(),
  sellerAddress: z.string().optional(),
  taxRegistrationNo: z.string().optional(),
  turnkeyBackend: z.enum(['local', 's3']).optional(),
  turnkeyInboundDir: z.string().optional(),
  turnkeyOutboundDir: z.string().optional(),
  turnkeyOnlineCode: z.string().optional(),
  qrAesKey: z.string().optional(),
  defaultTaxType: z.enum(['1', '2', '3']).optional(),
  enableCarrier: z.boolean().optional(),
  enableDonation: z.boolean().optional(),
  defaultPrintFlag: z.enum(['Y', 'N']).optional(),
});

tenantRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true, companyName: true, taxId: true, address: true,
        phone: true, email: true, logo: true, modules: true,
      },
    });
    res.json(t);
  } catch (err) { next(err); }
});

tenantRouter.put(
  '/me',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const data = { ...parsed.data };
      if (data.email === '') data.email = null;
      const t = await prisma.tenant.update({
        where: { id: req.tenantId },
        data,
        select: {
          id: true, companyName: true, taxId: true, address: true,
          phone: true, email: true, logo: true, modules: true,
        },
      });
      res.json(t);
    } catch (err) { next(err); }
  },
);

// ----- 電子發票設定 -----

tenantRouter.get('/me/einvoice-settings', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      const cfg = getTenantSettings(t?.settings).einvoice;
      // Never send qrAesKey in clear — return placeholder flag.
      res.json({ ...cfg, qrAesKeySet: !!cfg.qrAesKey, qrAesKey: undefined });
    } catch (err) { next(err); }
  },
);

tenantRouter.put('/me/einvoice-settings', requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = einvoiceSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      if (parsed.data.qrAesKey && !/^[0-9a-fA-F]{32}$/.test(parsed.data.qrAesKey)) {
        throw new ValidationError('AES 金鑰需為 32 字元 hex（16 bytes）');
      }
      const t = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      if (!t) throw new ValidationError('Tenant not found');
      const current = getTenantSettings(t.settings);
      // 強制移除使用者提交的賣方欄位（v2.7.4 起一律取自 Tenant.*；
      // 同時把舊資料殘留也清空，避免後續 fallback 路徑誤讀）
      const sanitized: Record<string, unknown> = { ...parsed.data };
      delete sanitized.sellerTaxId;
      delete sanitized.sellerName;
      delete sanitized.sellerAddress;
      const updated = {
        ...current,
        einvoice: {
          ...current.einvoice,
          ...sanitized,
          sellerTaxId: '',
          sellerName: '',
          sellerAddress: '',
        },
      };
      // Preserve existing qrAesKey if not provided.
      if (!parsed.data.qrAesKey) updated.einvoice.qrAesKey = current.einvoice.qrAesKey;
      const rawSettings =
        (typeof t.settings === 'object' && t.settings !== null) ? (t.settings as Record<string, unknown>) : {};
      await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { settings: { ...rawSettings, einvoice: updated.einvoice } as unknown as object },
      });
      res.json({ ...updated.einvoice, qrAesKeySet: !!updated.einvoice.qrAesKey, qrAesKey: undefined });
    } catch (err) { next(err); }
  },
);

// ----- 發票章 -----
//
// 圖檔本身存在 Fly volume `/data/stamps/<tenantId>.png`，settings 只記錄
// hasStamp + uploadedAt。任何登入者可預覽（GET），ADMIN 才可上傳/刪除。

tenantRouter.get('/me/invoice-stamp',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      const cfg = getTenantSettings(t?.settings).invoiceStamp;
      res.json(cfg);
    } catch (err) { next(err); }
  },
);

tenantRouter.get('/me/invoice-stamp/image',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = stampPathFor(req.tenantId);
      if (!existsSync(path)) { res.status(404).send('Not found'); return; }
      const buf = await readFile(path);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.send(buf);
    } catch (err) { next(err); }
  },
);

tenantRouter.post('/me/invoice-stamp',
  requireRole('ADMIN'),
  upload.single('stamp'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new ValidationError('未收到檔案（欄位名 stamp）');
      // 簡單魔術數字驗證 PNG（前 8 byte = 89 50 4E 47 0D 0A 1A 0A）
      const buf = req.file.buffer;
      const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (buf.length < 8 || !pngSig.every((b, i) => buf[i] === b)) {
        throw new ValidationError('僅接受 PNG 圖檔');
      }
      const opacityRaw = req.body?.opacity;
      const opacity = typeof opacityRaw === 'string' && opacityRaw !== ''
        ? Math.min(1, Math.max(0.1, Number(opacityRaw)))
        : 0.85;
      const path = stampPathFor(req.tenantId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buf);

      const t = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      const rawSettings = (typeof t?.settings === 'object' && t?.settings !== null)
        ? (t.settings as Record<string, unknown>) : {};
      const stampSettings = {
        hasStamp: true,
        uploadedAt: new Date().toISOString(),
        opacity,
      };
      await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { settings: { ...rawSettings, invoiceStamp: stampSettings } as unknown as object },
      });
      res.json(stampSettings);
    } catch (err) { next(err); }
  },
);

tenantRouter.delete('/me/invoice-stamp',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = stampPathFor(req.tenantId);
      if (existsSync(path)) {
        try { await unlink(path); } catch { /* ignore */ }
      }
      const t = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
      const rawSettings = (typeof t?.settings === 'object' && t?.settings !== null)
        ? (t.settings as Record<string, unknown>) : {};
      const stampSettings = { hasStamp: false, uploadedAt: '', opacity: 0.85 };
      await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { settings: { ...rawSettings, invoiceStamp: stampSettings } as unknown as object },
      });
      res.json(stampSettings);
    } catch (err) { next(err); }
  },
);
