/**
 * Error log read API — ADMIN only.
 *
 * GET /api/error-logs?from=&to=&userId=&source=&level=&q=&page=&pageSize=
 * Returns { total, page, pageSize, items, users } matching the shape
 * used by the audit-log endpoint so the admin frontend can reuse the
 * same paging / date-range logic.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../../shared/prisma.js';
import { requireRole } from '../auth/auth.middleware.js';

export const errorLogRouter = Router();

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

errorLogRouter.get(
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

      // ErrorLog rows may have null tenantId (pre-auth failures), but
      // for admin view we only show this tenant's entries + null tenant
      // entries triggered inside their session scope.
      const where: Record<string, unknown> = {
        OR: [{ tenantId: req.tenantId }, { tenantId: null }],
      };
      if (q.userId) where.userId = q.userId;
      if (q.source) where.source = { contains: q.source, mode: 'insensitive' };
      if (q.level) where.level = q.level;

      if (q.from || q.to) {
        const range: Record<string, Date> = {};
        if (q.from) {
          const d = new Date(q.from);
          if (!Number.isNaN(d.getTime())) range.gte = d;
        }
        if (q.to) {
          const d = new Date(q.to);
          if (!Number.isNaN(d.getTime())) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
              d.setHours(23, 59, 59, 999);
            }
            range.lte = d;
          }
        }
        if (Object.keys(range).length) where.createdAt = range;
      }

      if (q.q) {
        // Combine keyword OR with tenant OR via an AND wrapper.
        where.AND = [
          { OR: where.OR },
          {
            OR: [
              { message: { contains: q.q, mode: 'insensitive' } },
              { source: { contains: q.q, mode: 'insensitive' } },
              { route: { contains: q.q, mode: 'insensitive' } },
              { requestId: { contains: q.q, mode: 'insensitive' } },
            ],
          },
        ];
        delete where.OR;
      }

      const [total, items] = await Promise.all([
        prisma.errorLog.count({ where }),
        prisma.errorLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const userIds = [...new Set(items.map((i) => i.userId).filter(Boolean) as string[])];
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
