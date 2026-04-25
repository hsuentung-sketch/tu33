/**
 * Tenant self-service API — 公司資料（後台可改的那些欄位）。
 *
 * GET  /api/tenant/me     — 任何登入者可讀
 * PUT  /api/tenant/me     — ADMIN 限定
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../shared/prisma.js';
import { ValidationError } from '../../../shared/errors.js';
import { requireRole } from '../auth/auth.middleware.js';
import { getTenantSettings } from '../../../shared/utils.js';

export const tenantRouter = Router();

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
  sellerTaxId: z.string().optional(),
  sellerName: z.string().optional(),
  sellerAddress: z.string().optional(),
  taxRegistrationNo: z.string().optional(),
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
      const updated = {
        ...current,
        einvoice: { ...current.einvoice, ...parsed.data },
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
