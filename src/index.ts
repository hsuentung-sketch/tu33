import express from 'express';
import { config } from './config/index.js';
import { logger } from './shared/logger.js';
import { webhookRouter } from './line/webhook.js';
import { apiRouter } from './routes/index.js';
import { pdfRouter } from './routes/pdf.router.js';
import { AppError } from './shared/errors.js';
import { scheduleOverdueReminder } from './jobs/overdue-reminder.js';
import { scheduleMonthlyStatements } from './jobs/monthly-statement.js';
import { registerInventoryEventHandlers } from './modules/inventory/inventory.events.js';

const app = express();

// LINE webhook needs raw body for signature verification (mounted before json parser)
app.use('/webhook', webhookRouter);

// Static assets for LIFF frontend (served from public/)
app.use('/liff', express.static('public/liff'));

// JSON parsing for API routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public PDF download routes (token-authed via JWT, not LIFF id-token)
app.use('/pdf', pdfRouter);

// API routes
app.use('/api', apiRouter);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
});

// Bind explicitly to 0.0.0.0 so Render's IPv4 port scanner can detect us.
// Without the host arg, Node may bind to IPv6 only on some environments.
app.listen(config.port, '0.0.0.0', () => {
  logger.info(`ERP server running on 0.0.0.0:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  scheduleOverdueReminder();
  scheduleMonthlyStatements();
  registerInventoryEventHandlers();
});

export default app;
