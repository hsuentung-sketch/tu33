/**
 * Audit log read API — ADMIN only.
 *
 * GET /api/audit-logs?from=&to=&userId=&entity=&action=&q=&page=&pageSize=
 * Returns { total, page, pageSize, items, users } where `users` is a
 * small lookup for rendering actor names in the admin UI.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../../shared/prisma.js';
import { requireRole } from '../auth/auth.middleware.js';

export const auditLogRouter = Router();

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

auditLogRouter.get(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(q.pageSize || String(DEFAULT_PAGE_SIZE), 10)),
      );

      const where: Record<string, unknown> = { tenantId: req.tenantId };
      if (q.userId) where.userId = q.userId;
      if (q.entity) where.entity = q.entity;
      if (q.action) where.action = { contains: q.action, mode: 'insensitive' };

      if (q.from || q.to) {
        const range: Record<string, Date> = {};
        if (q.from) {
          const d = new Date(q.from);
          if (!Number.isNaN(d.getTime())) range.gte = d;
        }
        if (q.to) {
          const d = new Date(q.to);
          if (!Number.isNaN(d.getTime())) {
            // Treat "to" as inclusive end-of-day when only a date is given.
            if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
              d.setHours(23, 59, 59, 999);
            }
            range.lte = d;
          }
        }
        if (Object.keys(range).length) where.createdAt = range;
      }

      if (q.q) {
        where.OR = [
          { detail: { contains: q.q, mode: 'insensitive' } },
          { entityId: { contains: q.q, mode: 'insensitive' } },
          { action: { contains: q.q, mode: 'insensitive' } },
        ];
      }

      const [total, items] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // Resolve userIds → names for display. One round trip.
      const userIds = [...new Set(items.map((i) => i.userId).filter(Boolean))];
      const users = userIds.length
        ? await prisma.employee.findMany({
            where: { tenantId: req.tenantId, id: { in: userIds } },
            select: { id: true, employeeId: true, name: true },
          })
        : [];

      res.json({ total, page, pageSize, items, users });
    } catch (err) {
      next(err);
    }
  },
);
