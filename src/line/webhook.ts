import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import { validateSignature, webhook } from '@line/bot-sdk';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { handleEvent, type HandlerTenant } from './handlers/index.js';

export const webhookRouter = Router();

/**
 * Debug ring buffer — records the most recent webhook senders so that
 * an admin bootstrapping the tenant can discover their own LINE userId
 * without digging through logs.
 *
 * TODO: remove once all admins are bound.
 */
const recentSenders: Array<{ tenantId: string; userId: string; at: string }> = [];
export function recordSender(tenantId: string, userId: string): void {
  recentSenders.unshift({ tenantId, userId, at: new Date().toISOString() });
  if (recentSenders.length > 20) recentSenders.length = 20;
}
webhookRouter.get('/_debug/recent-senders', (_req, res) => {
  res.json(recentSenders);
});

/**
 * Per-tenant webhook path. Each tenant configures LINE Official Account
 * to POST to https://<host>/webhook/<tenantId>.
 */
webhookRouter.post(
  '/:tenantId',
  express.raw({ type: '*/*' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params as { tenantId: string };
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

      if (!tenant || !tenant.isActive || !tenant.lineChannelSecret || !tenant.lineAccessToken) {
        res.status(404).json({ error: 'Tenant not configured' });
        return;
      }

      const signature = req.header('x-line-signature') ?? '';
      const raw = req.body as Buffer;
      if (!validateSignature(raw.toString(), tenant.lineChannelSecret, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const body = JSON.parse(raw.toString()) as { events: webhook.Event[] };
      const handlerTenant: HandlerTenant = {
        id: tenant.id,
        lineAccessToken: tenant.lineAccessToken,
      };

      for (const ev of body.events) {
        const uid = (ev.source as { userId?: string } | undefined)?.userId;
        if (uid) recordSender(tenant.id, uid);
      }

      await Promise.all(body.events.map((ev) => handleEvent(ev, handlerTenant)));
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error('Webhook error', { error: err });
      next(err);
    }
  },
);
