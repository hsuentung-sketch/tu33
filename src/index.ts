import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { logger } from './shared/logger.js';
import { webhookRouter } from './line/webhook.js';
import { apiRouter } from './routes/index.js';
import { pdfRouter } from './routes/pdf.router.js';
import { shortLinkRouter } from './modules/core/shortlink/shortlink.router.js';
import { AppError } from './shared/errors.js';
import { writeErrorLog, runWithRequestContext, newRequestId } from './shared/error-log.js';
import { scheduleOverdueReminder } from './jobs/overdue-reminder.js';
import { scheduleMonthlyStatements } from './jobs/monthly-statement.js';
import { scheduleDailyBackup } from './jobs/daily-backup.js';
import { scheduleEinvoiceSync } from './jobs/einvoice-sync.js';
import { scheduleDailyVersionAutoUpgrade } from './jobs/daily-version-auto-upgrade.js';
import { scheduleDailyBillingAutoRenewal } from './jobs/daily-billing-auto-renewal.js';
import { scheduleDailyBillingOverdueCheck } from './jobs/daily-billing-overdue-check.js';
import { runEinvoiceBootCheck } from './jobs/einvoice-boot-check.js';
import { registerInventoryEventHandlers } from './modules/inventory/inventory.events.js';
import { registerAutoJournalHandlers } from './modules/accounting/journal/auto-journal.js';
import { platformRouter } from './modules/core/platform/platform.router.js';

const app = express();

// Request-scoped context (requestId for correlation; tenant/user filled
// in later by auth middleware). Wrapped in AsyncLocalStorage so
// writeErrorLog can pull the values from anywhere in the call chain.
app.use((req, _res, next) => {
  runWithRequestContext({ requestId: newRequestId(), route: `${req.method} ${req.path}` }, () => next());
});

// LINE webhook needs raw body for signature verification (mounted before json parser)
app.use('/webhook', webhookRouter);

// Static assets for LIFF frontend (served from public/)
app.use('/liff', express.static('public/liff'));

// Backoffice admin console (static SPA shell + login page).
// Auth happens at the API layer; the static files themselves are public.
app.use('/admin', express.static('public/admin'));

// JSON parsing for API routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root → admin console. Bookmark targets without /admin/ should land somewhere useful.
app.get('/', (_req, res) => {
  res.redirect(302, '/admin/');
});

// Public PDF download routes (token-authed via JWT, not LIFF id-token)
app.use('/pdf', pdfRouter);

// Public short-link resolver — 302 redirects to stored target URL.
// Mounted before authMiddleware so LINE users can tap the short URL
// directly from chat. The target still carries its own auth (JWT).
app.use('/s', shortLinkRouter);

// SaaS platform admin console (static SPA + API)
app.use('/saas-admin', express.static('public/saas-admin'));
app.use('/api/platform', platformRouter);

// API routes
app.use('/api', apiRouter);

// Map Prisma known-request errors to friendly 4xx responses so the
// frontend / LINE chat can show meaningful messages instead of a
// generic "Internal server error" (v2.9.3+).
function mapPrismaError(err: unknown):
  | { statusCode: number; code: string; message: string }
  | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { name?: string; code?: string; meta?: Record<string, unknown> };
  if (e.name !== 'PrismaClientKnownRequestError' || typeof e.code !== 'string') return null;
  const meta = e.meta ?? {};
  const target = Array.isArray(meta.target)
    ? meta.target.join(', ')
    : typeof meta.target === 'string' ? meta.target : '';
  switch (e.code) {
    case 'P2002':
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: target
          ? `重複的資料（欄位：${target}）。請改用其他值。`
          : '資料重複，請改用其他值。',
      };
    case 'P2003':
      return {
        statusCode: 400,
        code: 'FK_VIOLATION',
        message: '關聯資料不存在或被其他紀錄引用，無法完成此動作。',
      };
    case 'P2025':
      return { statusCode: 404, code: 'NOT_FOUND', message: '找不到此筆紀錄。' };
    case 'P2022':
      return {
        statusCode: 503,
        code: 'SCHEMA_DRIFT',
        message: '資料庫欄位不一致，請聯絡管理員執行升級 SQL。',
      };
    default:
      return null;
  }
}

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    // Expected validation / not-found errors — don't persist, just return.
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // Recognise Prisma known errors → friendly 4xx instead of generic 500.
  const prismaMapped = mapPrismaError(err);
  if (prismaMapped) {
    res.status(prismaMapped.statusCode).json({
      error: { code: prismaMapped.code, message: prismaMapped.message },
    });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });

  // Durable error log for the admin "異常紀錄" view.
  void writeErrorLog({
    level: 'error',
    source: `api.${req.method.toLowerCase()}.${req.path}`,
    message: err.message,
    stack: err.stack ?? null,
    route: `${req.method} ${req.path}`,
    statusCode: 500,
    context: {
      query: req.query,
      // Body can be huge or contain secrets — omit by default.
    },
  });

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
  scheduleDailyBackup();
  scheduleEinvoiceSync();
  scheduleDailyVersionAutoUpgrade();
  scheduleDailyBillingAutoRenewal();
  scheduleDailyBillingOverdueCheck(); // P0-3c: Daily overdue check at 04:00
  registerInventoryEventHandlers();
  registerAutoJournalHandlers();
  void runEinvoiceBootCheck();
});

export default app;
