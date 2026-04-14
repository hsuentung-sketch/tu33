import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from './logger.js';

/**
 * Request-scoped audit context. The Express auth middleware stores
 * the acting user here; the Prisma extension reads it to tag log rows.
 */
export interface AuditContext {
  tenantId: string;
  userId: string;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: AuditContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

// Models that should be audited.
const AUDITED_MODELS = new Set([
  'Quotation',
  'SalesOrder',
  'PurchaseOrder',
  'AccountReceivable',
  'AccountPayable',
  'Employee',
  'Customer',
  'Supplier',
  'Product',
]);

const WRITE_OPS = new Set(['create', 'update', 'delete', 'upsert']);

// A dedicated raw client for writing audit rows. Kept separate from the
// app-facing extended client to avoid recursion through the extension.
const globalForAudit = globalThis as unknown as { auditClient?: PrismaClient };
function createAuditClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter, log: ['error'] });
}
const auditClient = globalForAudit.auditClient ?? createAuditClient();
if (process.env.NODE_ENV !== 'production') {
  globalForAudit.auditClient = auditClient;
}

export const auditExtension = Prisma.defineExtension({
  name: 'audit-log',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);

        if (!model || !AUDITED_MODELS.has(model) || !WRITE_OPS.has(operation)) {
          return result;
        }

        const ctx = getAuditContext();
        if (!ctx) return result;

        const entityId =
          (result as { id?: string })?.id ??
          (args as { where?: { id?: string } })?.where?.id ??
          'unknown';

        try {
          await auditClient.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              action: `${operation.toUpperCase()}_${model.toUpperCase()}`,
              entity: model,
              entityId,
              detail: summarizeArgs(args),
            },
          });
        } catch (err) {
          logger.warn('Audit log write failed', { error: err, model, operation });
        }

        return result;
      },
    },
  },
});

function summarizeArgs(args: unknown): string | null {
  try {
    const s = JSON.stringify(args);
    return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
  } catch {
    return null;
  }
}
