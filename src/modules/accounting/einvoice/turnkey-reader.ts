import { promises as fs } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { prisma } from '../../../shared/prisma.js';
import { logger } from '../../../shared/logger.js';

/**
 * Turnkey outbound reader. Scans the configured tenant's outbound
 * directory for reply files, matches each to an Einvoice by invoice
 * number, and updates the row's status.
 *
 * Expected filename forms (kept liberal so different Turnkey versions
 * plug in cleanly):
 *   - `<invoiceNo>.xml` (any marker file is treated as `confirmed`)
 *   - `<invoiceNo>_CONFIRMED.xml`
 *   - `<invoiceNo>_REJECTED.xml` → status=rejected; file body (if present)
 *      is saved into rejectReason (truncated to 400 chars).
 *
 * Processed files are renamed to `<original>.processed-<epoch>` so the
 * next run doesn't re-handle them. Failures are logged but do not abort
 * the whole batch.
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
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const einvoice = (settings.einvoice ?? {}) as Record<string, unknown>;
  const dir = String(einvoice.turnkeyOutboundDir ?? '');
  if (!dir || !isAbsolute(dir)) return summary;

  let entries: string[];
  try {
    entries = await fs.readdir(resolve(dir));
  } catch (err) {
    logger.warn('einvoice sync: cannot read outbound dir', { tenantId, dir, err });
    return summary;
  }

  for (const name of entries) {
    if (!/\.xml$/i.test(name)) continue;
    if (/\.processed-\d+$/i.test(name)) continue;
    summary.scanned++;
    const full = join(resolve(dir), name);

    const invoiceNoMatch = name.match(/^([A-Z]{2}\d{8})/);
    if (!invoiceNoMatch) { summary.skipped++; continue; }
    const invoiceNo = invoiceNoMatch[1];
    const rejected = /REJECT/i.test(name);

    try {
      const inv = await prisma.einvoice.findUnique({
        where: { tenantId_invoiceNo: { tenantId, invoiceNo } },
      });
      if (!inv) { summary.skipped++; continue; }
      let reason: string | null = null;
      if (rejected) {
        try {
          const body = await fs.readFile(full, 'utf8');
          reason = body.length > 400 ? body.slice(0, 400) : body;
        } catch { /* ignore */ }
      }
      await prisma.einvoice.update({
        where: { id: inv.id },
        data: rejected
          ? { status: 'rejected', rejectReason: reason }
          : { status: 'confirmed', confirmedAt: new Date() },
      });
      await fs.rename(full, `${full}.processed-${Date.now()}`).catch(() => { /* non-fatal */ });
      summary.updated++;
    } catch (err) {
      summary.errors++;
      logger.warn('einvoice sync: failed entry', { name, err });
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
