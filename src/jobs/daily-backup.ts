/**
 * Daily database backup job.
 *
 * Strategy:
 *   1. Try `pg_dump $DATABASE_URL | gzip` via shell exec (produces
 *      full SQL dump — ideal for disaster recovery).
 *   2. If pg_dump is unavailable (ENOENT), fall back to a Prisma-based
 *      JSON export: every table → JSON → gzipped into a single file.
 *   3. Email the attachment to BACKUP_EMAIL_TO.
 *
 * Runs nightly at 02:00 Asia/Taipei. Can be triggered manually via
 * POST /api/statements/backup (ADMIN).
 */
import cron from 'node-cron';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { logger } from '../shared/logger.js';
import { writeErrorLog } from '../shared/error-log.js';
import { prisma } from '../shared/prisma.js';
import { sendEmail } from '../documents/email-sender.js';

const BACKUP_EMAIL_TO = process.env.BACKUP_EMAIL_TO || '';

/**
 * Stream pg_dump → gzip → collect into a single Buffer.
 * Rejects with code 'PG_DUMP_MISSING' if pg_dump binary isn't installed.
 */
async function pgDumpToBuffer(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = process.env.DATABASE_URL;
    if (!url) return reject(new Error('DATABASE_URL not set'));

    const proc = spawn('pg_dump', [url, '--no-owner', '--no-privileges'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    let stderrText = '';
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => { stderrText += c.toString(); });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        const e: NodeJS.ErrnoException = new Error('pg_dump binary not found in PATH');
        e.code = 'PG_DUMP_MISSING';
        reject(e);
      } else reject(err);
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`pg_dump exited with code ${code}: ${stderrText.slice(0, 500)}`));
      }
      const raw = Buffer.concat(chunks);
      try { resolve(gzipSync(raw)); } catch (e) { reject(e); }
    });
  });
}

/**
 * Fallback: dump every known Prisma table as JSON, concat into one
 * document, gzip. Not a full SQL restore — but preserves row content.
 */
async function prismaJsonDump(): Promise<Buffer> {
  const tables: Array<[string, () => Promise<unknown[]>]> = [
    ['tenant', () => prisma.tenant.findMany()],
    ['employee', () => prisma.employee.findMany()],
    ['product', () => prisma.product.findMany()],
    ['productDocument', () => prisma.productDocument.findMany()],
    ['customer', () => prisma.customer.findMany()],
    ['supplier', () => prisma.supplier.findMany()],
    ['quotation', () => prisma.quotation.findMany()],
    ['quotationItem', () => prisma.quotationItem.findMany()],
    ['salesOrder', () => prisma.salesOrder.findMany()],
    ['salesItem', () => prisma.salesItem.findMany()],
    ['purchaseOrder', () => prisma.purchaseOrder.findMany()],
    ['purchaseItem', () => prisma.purchaseItem.findMany()],
    ['accountReceivable', () => prisma.accountReceivable.findMany()],
    ['accountPayable', () => prisma.accountPayable.findMany()],
    ['inventory', () => prisma.inventory.findMany()],
    ['inventoryTransaction', () => prisma.inventoryTransaction.findMany()],
    ['auditLog', () => prisma.auditLog.findMany()],
    ['errorLog', () => prisma.errorLog.findMany()],
    ['shortLink', () => prisma.shortLink.findMany()],
  ];

  const dump: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    format: 'prisma-json-v1',
  };
  for (const [name, fetcher] of tables) {
    try {
      dump[name] = await fetcher();
    } catch (err) {
      dump[name] = { __error: (err as Error).message };
      logger.warn(`prismaJsonDump: failed to fetch ${name}`, { error: (err as Error).message });
    }
  }
  // BigInt-safe replacer (Prisma Decimal stringifies fine as JSON string).
  const json = JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  return gzipSync(Buffer.from(json, 'utf8'));
}

export async function runDailyBackup(): Promise<{ ok: boolean; mode: string; size: number; sentTo: string }> {
  if (!BACKUP_EMAIL_TO) {
    const msg = 'BACKUP_EMAIL_TO env var not set; skipping backup';
    logger.warn(msg);
    await writeErrorLog({ level: 'warn', source: 'job.daily-backup', message: msg });
    throw new Error(msg);
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let buf: Buffer;
  let filename: string;
  let mode: 'sql-gz' | 'json-gz';

  try {
    buf = await pgDumpToBuffer();
    filename = `backup-${stamp}.sql.gz`;
    mode = 'sql-gz';
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'PG_DUMP_MISSING') {
      logger.warn('pg_dump missing, falling back to Prisma JSON dump');
      buf = await prismaJsonDump();
      filename = `backup-${stamp}.json.gz`;
      mode = 'json-gz';
    } else {
      logger.error('pg_dump failed (non-ENOENT)', { error: e.message });
      await writeErrorLog({ source: 'job.daily-backup', message: `pg_dump failed: ${e.message}` });
      // Still try the JSON fallback so the user isn't left without a backup.
      buf = await prismaJsonDump();
      filename = `backup-${stamp}.json.gz`;
      mode = 'json-gz';
    }
  }

  try {
    await sendEmail({
      to: BACKUP_EMAIL_TO,
      subject: `[ERP 備份] ${stamp} (${mode})`,
      text: `每日資料庫備份。\n\n檔案：${filename}\n模式：${mode}\n大小：${(buf.length / 1024).toFixed(1)} KB\n產生時間：${new Date().toISOString()}\n\n${
        mode === 'sql-gz'
          ? '還原：gunzip backup.sql.gz && psql <db_url> < backup.sql'
          : '還原：需用自訂腳本讀 JSON 後透過 Prisma 寫回。'
      }`,
      attachments: [{
        filename,
        content: buf,
        contentType: 'application/gzip',
      }],
    });
  } catch (err) {
    const msg = `backup email send failed: ${(err as Error).message}`;
    logger.error(msg);
    await writeErrorLog({ source: 'job.daily-backup', message: msg });
    throw err;
  }

  logger.info('Daily backup sent', { mode, size: buf.length, sentTo: BACKUP_EMAIL_TO });
  return { ok: true, mode, size: buf.length, sentTo: BACKUP_EMAIL_TO };
}

export function scheduleDailyBackup(): void {
  // 每日 02:00 Asia/Taipei
  cron.schedule('0 2 * * *', async () => {
    try { await runDailyBackup(); }
    catch (err) { logger.error('scheduled backup failed', { error: (err as Error).message }); }
  }, { timezone: 'Asia/Taipei' });
  logger.info('Daily backup scheduled: 02:00 Asia/Taipei');
}
