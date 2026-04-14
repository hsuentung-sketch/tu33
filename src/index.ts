import express from 'express';
import { config } from './config/index.js';
import { logger } from './shared/logger.js';
import { webhookRouter } from './line/webhook.js';
import { apiRouter } from './routes/index.js';
import { AppError } from './shared/errors.js';

const app = express();

// LINE webhook needs raw body for signature verification (mounted before json parser)
app.use('/webhook', webhookRouter);

// JSON parsing for API routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

app.listen(config.port, () => {
  logger.info(`ERP server running on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});

export default app;
