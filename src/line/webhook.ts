import { Router } from 'express';
import { middleware, webhook } from '@line/bot-sdk';
import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';
import { handleEvent } from './handlers/index.js';

export const webhookRouter = Router();

// LINE signature verification middleware
webhookRouter.post(
  '/',
  middleware({ channelSecret: config.line.channelSecret }),
  async (req, res) => {
    const events: webhook.Event[] = req.body.events;

    try {
      await Promise.all(events.map(handleEvent));
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error('Webhook handler error', { error: err });
      res.status(500).json({ status: 'error' });
    }
  },
);
