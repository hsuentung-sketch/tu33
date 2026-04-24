import { promises as fs } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { ValidationError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';

/**
 * Stub turnkey writer — writes MIG XML to a local directory that Turnkey
 * is (in production) configured to read.
 *
 * This is deliberately a thin local-FS implementation so Phase 1 can
 * exercise the full code path locally. For production on Fly.io the
 * container FS is ephemeral; replace the writeFile line with an SFTP
 * push / S3 putObject and keep the `write()` signature stable.
 *
 * Security:
 *  - The target directory must be absolute and must already exist — we
 *    never auto-create, to prevent path-traversal pop-out.
 *  - Filenames are derived from the seller-assigned invoice number
 *    (alphanumeric only) + timestamp; user-supplied input cannot bleed
 *    into path components.
 */

function safeFilenameSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '');
}

export interface WriteResult {
  absolutePath: string;
}

async function ensureWritableDir(dir: string): Promise<string> {
  if (!dir) throw new ValidationError('Turnkey inbound 目錄未設定（Tenant.settings.einvoice.turnkeyInboundDir）');
  if (!isAbsolute(dir)) throw new ValidationError('Turnkey inbound 目錄必須為絕對路徑');
  const resolved = resolve(dir);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ValidationError(`Turnkey inbound 目錄不存在或不可讀：${resolved}`);
  }
  return resolved;
}

export async function writeIssueXml(opts: {
  inboundDir: string;
  invoiceNo: string;
  xml: string;
}): Promise<WriteResult> {
  const dir = await ensureWritableDir(opts.inboundDir);
  const ts = Date.now();
  const fname = `C0401_${safeFilenameSegment(opts.invoiceNo)}_${ts}.xml`;
  const full = join(dir, fname);
  await fs.writeFile(full, opts.xml, 'utf8');
  logger.info('einvoice: wrote C0401', { invoiceNo: opts.invoiceNo, path: full });
  return { absolutePath: full };
}

export async function writeVoidXml(opts: {
  inboundDir: string;
  invoiceNo: string;
  xml: string;
}): Promise<WriteResult> {
  const dir = await ensureWritableDir(opts.inboundDir);
  const ts = Date.now();
  const fname = `C0501_${safeFilenameSegment(opts.invoiceNo)}_${ts}.xml`;
  const full = join(dir, fname);
  await fs.writeFile(full, opts.xml, 'utf8');
  logger.info('einvoice: wrote C0501', { invoiceNo: opts.invoiceNo, path: full });
  return { absolutePath: full };
}
