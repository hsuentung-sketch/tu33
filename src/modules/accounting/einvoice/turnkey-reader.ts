import { prisma } from '../../../shared/prisma.js';
import { logger } from '../../../shared/logger.js';
import { getTenantSettings } from '../../../shared/utils.js';
import { buildStorageEnv, listOutbound, readOutbound, markProcessed } from './turnkey-storage.js';

/**
 * Turnkey outbound reader（v2.11.0+）。
 *
 * 透過 `turnkey-storage.ts` 介面從本機 FS 或 S3-compatible bucket 拉
 * Turnkey 回執，更新對應 Einvoice row 的 status。
 *
 * 檔名規格（與舊版相同，允許 Turnkey 不同版本插）：
 *   - `<invoiceNo>.xml` → confirmed
 *   - `<invoiceNo>_CONFIRMED.xml` → confirmed
 *   - `<invoiceNo>_REJECTED.xml` → rejected；檔身（若可讀）截到 400 字寫 rejectReason
 *
 * 處理過的檔加 `.processed-<ts>` 後綴避免重複處理。
 */

export interface SyncSummary {
  tenantId: string;
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
}

export async function syncTenant(tenantId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { tenantId, scanned: 0, updated: 0, skipped: 0, errors: 0 };

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return summary;
  const cfg = getTenantSettings(tenant.settings).einvoice;
  if (!cfg.enabled || !cfg.turnkeyOutboundDir) return summary;

  const env = buildStorageEnv({
    turnkeyBackend: cfg.turnkeyBackend,
    turnkeyInboundDir: cfg.turnkeyInboundDir,
    turnkeyOutboundDir: cfg.turnkeyOutboundDir,
  });

  let entries;
  try {
    entries = await listOutbound(env);
  } catch (err) {
    logger.warn('einvoice sync: cannot list outbound', { tenantId, backend: env.backend, err });
    return summary;
  }

  for (const entry of entries) {
    summary.scanned++;
    const invoiceNoMatch = entry.filename.match(/^([A-Z]{2}\d{8})/);
    if (!invoiceNoMatch) { summary.skipped++; continue; }
    const invoiceNo = invoiceNoMatch[1];
    const rejected = /REJECT/i.test(entry.filename);

    try {
      const inv = await prisma.einvoice.findUnique({
        where: { tenantId_invoiceNo: { tenantId, invoiceNo } },
      });
      if (!inv) { summary.skipped++; continue; }
      let reason: string | null = null;
      if (rejected) {
        try {
          const body = await readOutbound(env, entry.key);
          reason = body.length > 400 ? body.slice(0, 400) : body;
        } catch { /* ignore */ }
      }
      await prisma.einvoice.update({
        where: { id: inv.id },
        data: rejected
          ? { status: 'rejected', rejectReason: reason }
          : { status: 'confirmed', confirmedAt: new Date() },
      });
      await markProcessed(env, entry.key);
      summary.updated++;
    } catch (err) {
      summary.errors++;
      logger.warn('einvoice sync: failed entry', { name: entry.filename, err });
    }
  }
  return summary;
}

export async function syncAllTenants(): Promise<SyncSummary[]> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const out: SyncSummary[] = [];
  for (const t of tenants) out.push(await syncTenant(t.id));
  return out;
}
