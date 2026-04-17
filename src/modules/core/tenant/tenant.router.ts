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

export const tenantRouter = Router();

const updateSchema = z.object({
  companyName: z.string().min(1).optional(),
  taxId: z.string().max(20).nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  logo: z.string().nullable().optional(),
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
