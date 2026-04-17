import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import { validateSignature, webhook } from '@line/bot-sdk';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { logError } from '../shared/error-log.js';
import { handleEvent, type HandlerTenant } from './handlers/index.js';

export const webhookRouter = Router();

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

      await Promise.all(body.events.map((ev) => handleEvent(ev, handlerTenant)));
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error('Webhook error', { error: err });
      void logError('line.webhook', err, {
        tenantId: (req.params as { tenantId?: string }).tenantId ?? null,
        route: `POST /webhook/${(req.params as { tenantId?: string }).tenantId ?? ''}`,
      });
      next(err);
    }
  },
);
