import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../auth/auth.middleware.js';
import * as svc from './announcement.service.js';
import { prisma } from '../../../shared/prisma.js';
import { getLineClient } from '../../../line/client.js';
import { logger } from '../../../shared/logger.js';

export const announcementRouter = Router();

announcementRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeExpired = req.query.all === 'true';
    const rows = includeExpired
      ? await svc.listAll(req.tenantId)
      : await svc.list(req.tenantId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

announcementRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await svc.getById(req.tenantId, req.params.id as string);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

announcementRouter.post('/', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content, priority, isPublished, expiresAt, pushToLine } = req.body;
    const row = await svc.create(req.tenantId, req.employee.id, {
      title,
      content,
      priority,
      isPublished,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    if (pushToLine) {
      pushAnnouncementToLine(req.tenantId, row.title, row.content).catch((err) => {
        logger.warn('Failed to push announcement to LINE', { error: (err as Error).message });
      });
    }

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

announcementRouter.put('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content, priority, isPublished, expiresAt } = req.body;
    const row = await svc.update(req.tenantId, req.params.id as string, {
      title,
      content,
      priority,
      isPublished,
      expiresAt: expiresAt === null ? null : expiresAt ? new Date(expiresAt) : undefined,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

announcementRouter.delete('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.remove(req.tenantId, req.params.id as string);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function pushAnnouncementToLine(tenantId: string, title: string, content: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { lineAccessToken: true, companyName: true },
  });
  if (!tenant?.lineAccessToken) return;

  const client = getLineClient(tenant.lineAccessToken);
  const employees = await prisma.employee.findMany({
    where: { tenantId, isActive: true, lineUserId: { not: null } },
    select: { lineUserId: true },
  });

  const text = `[公告] ${title}\n\n${content}`;
  for (const emp of employees) {
    if (!emp.lineUserId) continue;
    try {
      await client.pushMessage({
        to: emp.lineUserId,
        messages: [{ type: 'text', text }],
      });
    } catch (err) {
      logger.warn('Announcement LINE push failed', {
        tenantId,
        error: (err as Error).message,
      });
    }
  }
}
