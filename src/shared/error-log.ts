/**
 * Structured error logging — writes to the ErrorLog table so runtime
 * exceptions are visible in the admin "異常紀錄" view.
 *
 * Fire-and-forget: failures are swallowed (we warn via winston, but we
 * never re-throw, since this is itself the error path).
 *
 * The logger.ts winston logger remains the primary sink for stdout;
 * writeErrorLog is an *additional* durable sink for high-signal events.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  route?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Enrich the current request context in place. Call from auth middleware
 * once the tenant/employee have been resolved so error logs carry them.
 */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}

export interface ErrorLogInput {
  level?: 'error' | 'warn';
  source: string;
  message: string;
  stack?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  requestId?: string | null;
  route?: string | null;
  statusCode?: number | null;
  context?: Record<string, unknown> | null;
}

/**
 * Persist an error/warn entry. Safe to await or to call fire-and-forget.
 * Pulls missing tenantId/userId/requestId/route from the current AsyncLocalStorage.
 */
export async function writeErrorLog(input: ErrorLogInput): Promise<void> {
  try {
    const req = getRequestContext();
    await prisma.errorLog.create({
      data: {
        level: input.level ?? 'error',
        source: input.source,
        message: truncate(input.message, 2000),
        stack: input.stack ? truncate(input.stack, 8000) : null,
        tenantId: input.tenantId ?? req?.tenantId ?? null,
        userId: input.userId ?? req?.userId ?? null,
        requestId: input.requestId ?? req?.requestId ?? null,
        route: input.route ?? req?.route ?? null,
        statusCode: input.statusCode ?? null,
        context: (input.context ?? null) as never,
      },
    });
  } catch (err) {
    // Don't let logging failures escape.
    logger.warn('writeErrorLog failed', {
      error: (err as Error).message,
      source: input.source,
    });
  }
}

/**
 * Convenience wrapper that accepts an Error. Keeps logger.error() ergonomic.
 */
export async function logError(source: string, err: unknown, extra?: Partial<ErrorLogInput>): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  await writeErrorLog({
    source,
    message: e.message,
    stack: e.stack ?? null,
    ...extra,
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
