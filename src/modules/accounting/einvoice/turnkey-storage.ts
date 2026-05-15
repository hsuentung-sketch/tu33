/**
 * Turnkey XML storage 抽象層（v2.11.0+）
 *
 * 解決 TODO「Fly ↔ 公司主機 XML 同步機制決策」。
 *
 * 兩個 backend：
 *  - `local`：本機 FS（dev / single-machine 部署）。Fly 容器 FS 是 ephemeral，
 *    重啟丟失，**不適合 production**。
 *  - `s3`：S3-compatible object storage（Cloudflare R2 / Fly Tigris / MinIO / AWS S3）。
 *    Fly 寫入 bucket，公司主機端跑 rclone（或類似工具）每 N 分鐘拉 inbound prefix
 *    到 Turnkey 整合服務的 inbound 目錄；Turnkey 寫出的回執也上傳到 outbound prefix，
 *    Fly cron 每天掃。
 *
 * 統一介面：
 *  - `putXml(env, kind, invoiceNo, xml)`：寫一份 XML。
 *  - `listOutbound(env)`：列 outbound 目錄/prefix 中的檔名。
 *  - `readOutbound(env, key)`：讀一份檔的內容。
 *  - `markProcessed(env, key)`：把處理過的檔搬到「已處理」狀態
 *    （local: rename .processed-<ts>；s3: 加 metadata 或 copy 到 archive prefix）。
 *
 * Env 來源：
 *  - tenant.settings.einvoice.turnkeyBackend：'local' | 's3'（預設 local）
 *  - turnkeyInboundDir / turnkeyOutboundDir：local 是絕對路徑；s3 是 prefix（如 `tenant-abc/inbound/`）
 *  - S3 端 endpoint / region / bucket / accessKey / secret：走 process.env（全機共用，per-tenant 隔離靠 prefix）
 *    - TURNKEY_S3_ENDPOINT（如 `https://xxx.r2.cloudflarestorage.com`）
 *    - TURNKEY_S3_REGION（R2 用 `auto`、Tigris 用 `auto`、AWS 用 region）
 *    - TURNKEY_S3_BUCKET
 *    - TURNKEY_S3_ACCESS_KEY
 *    - TURNKEY_S3_SECRET
 *
 * 為什麼 access key 走 env 不走 DB：
 *  1. 鑰匙不應落到 settings JSON / audit log
 *  2. 同公司多 tenant 共用一個 bucket，省 ops
 *  3. 換 key 不必動 DB
 */

import { promises as fs } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { ValidationError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';

export type TurnkeyBackend = 'local' | 's3';
export type TurnkeyXmlKind = 'C0401' | 'C0501' | 'D0401' | 'D0501';

export interface TurnkeyStorageEnv {
  backend: TurnkeyBackend;
  inboundDir: string;   // local：絕對路徑；s3：prefix（含尾 `/`）
  outboundDir: string;  // 同上
}

export interface PutResult {
  /** local：絕對檔案路徑；s3：bucket 內 key */
  locator: string;
}

export interface OutboundEntry {
  key: string;        // local：絕對路徑；s3：bucket 內 key
  filename: string;   // 純檔名（無前綴）
}

function safeFilenameSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '');
}

function nowEpoch(): number {
  return Date.now();
}

// ============================================================
// Local backend
// ============================================================

async function ensureLocalDir(dir: string): Promise<string> {
  if (!dir) throw new ValidationError('Turnkey 目錄未設定');
  if (!isAbsolute(dir)) throw new ValidationError(`Turnkey 目錄必須為絕對路徑：${dir}`);
  const resolved = resolve(dir);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ValidationError(`Turnkey 目錄不存在或不可讀：${resolved}`);
  }
  return resolved;
}

async function localPut(env: TurnkeyStorageEnv, kind: TurnkeyXmlKind, invoiceNo: string, xml: string): Promise<PutResult> {
  const dir = await ensureLocalDir(env.inboundDir);
  const fname = `${kind}_${safeFilenameSegment(invoiceNo)}_${nowEpoch()}.xml`;
  const full = join(dir, fname);
  await fs.writeFile(full, xml, 'utf8');
  return { locator: full };
}

async function localList(env: TurnkeyStorageEnv): Promise<OutboundEntry[]> {
  if (!env.outboundDir || !isAbsolute(env.outboundDir)) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(resolve(env.outboundDir));
  } catch {
    return [];
  }
  return entries
    .filter((n) => /\.xml$/i.test(n) && !/\.processed-\d+$/i.test(n))
    .map((n) => ({ key: join(resolve(env.outboundDir), n), filename: n }));
}

async function localRead(_env: TurnkeyStorageEnv, key: string): Promise<string> {
  return fs.readFile(key, 'utf8');
}

async function localMarkProcessed(_env: TurnkeyStorageEnv, key: string): Promise<void> {
  await fs.rename(key, `${key}.processed-${nowEpoch()}`).catch(() => { /* non-fatal */ });
}

// ============================================================
// S3 backend
// ============================================================

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secret: string;
  client: AwsClient;
}

let cachedS3: S3Config | null = null;

function getS3Config(): S3Config {
  if (cachedS3) return cachedS3;
  const endpoint = process.env.TURNKEY_S3_ENDPOINT?.replace(/\/+$/, '') ?? '';
  const region = process.env.TURNKEY_S3_REGION ?? 'auto';
  const bucket = process.env.TURNKEY_S3_BUCKET ?? '';
  const accessKey = process.env.TURNKEY_S3_ACCESS_KEY ?? '';
  const secret = process.env.TURNKEY_S3_SECRET ?? '';
  if (!endpoint || !bucket || !accessKey || !secret) {
    throw new ValidationError(
      'S3 backend 未設定齊全（需 TURNKEY_S3_ENDPOINT / TURNKEY_S3_BUCKET / TURNKEY_S3_ACCESS_KEY / TURNKEY_S3_SECRET）',
    );
  }
  cachedS3 = {
    endpoint,
    region,
    bucket,
    accessKey,
    secret,
    client: new AwsClient({ accessKeyId: accessKey, secretAccessKey: secret, region, service: 's3' }),
  };
  return cachedS3;
}

function normalizePrefix(p: string): string {
  if (!p) return '';
  let out = p.replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!out.endsWith('/')) out += '/';
  return out;
}

function s3Url(cfg: S3Config, key: string): string {
  return `${cfg.endpoint}/${cfg.bucket}/${key}`;
}

async function s3Put(env: TurnkeyStorageEnv, kind: TurnkeyXmlKind, invoiceNo: string, xml: string): Promise<PutResult> {
  const cfg = getS3Config();
  const prefix = normalizePrefix(env.inboundDir);
  const key = `${prefix}${kind}_${safeFilenameSegment(invoiceNo)}_${nowEpoch()}.xml`;
  const res = await cfg.client.fetch(s3Url(cfg, key), {
    method: 'PUT',
    headers: { 'content-type': 'application/xml; charset=utf-8' },
    body: xml,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`S3 PUT 失敗 ${res.status}: ${body.slice(0, 200)}`);
  }
  return { locator: key };
}

async function s3List(env: TurnkeyStorageEnv): Promise<OutboundEntry[]> {
  const cfg = getS3Config();
  const prefix = normalizePrefix(env.outboundDir);
  if (!prefix) return [];
  const url = `${cfg.endpoint}/${cfg.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const res = await cfg.client.fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`S3 LIST 失敗 ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  // 極輕量 XML 解析：抓所有 <Key>...</Key>
  const keys = Array.from(text.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1]);
  return keys
    .filter((k) => k.endsWith('.xml') && !k.includes('.processed-'))
    .map((k) => ({ key: k, filename: k.slice(prefix.length) }));
}

async function s3Read(_env: TurnkeyStorageEnv, key: string): Promise<string> {
  const cfg = getS3Config();
  const res = await cfg.client.fetch(s3Url(cfg, key));
  if (!res.ok) throw new Error(`S3 GET 失敗 ${res.status}`);
  return res.text();
}

async function s3MarkProcessed(_env: TurnkeyStorageEnv, key: string): Promise<void> {
  const cfg = getS3Config();
  const newKey = `${key}.processed-${nowEpoch()}`;
  // S3 沒有 rename：copy + delete
  const copyRes = await cfg.client.fetch(s3Url(cfg, newKey), {
    method: 'PUT',
    headers: { 'x-amz-copy-source': `/${cfg.bucket}/${key}` },
  });
  if (!copyRes.ok) {
    logger.warn('einvoice s3: copy for markProcessed 失敗', { key, status: copyRes.status });
    return;
  }
  const delRes = await cfg.client.fetch(s3Url(cfg, key), { method: 'DELETE' });
  if (!delRes.ok) {
    logger.warn('einvoice s3: delete after copy 失敗', { key, status: delRes.status });
  }
}

// ============================================================
// Dispatcher
// ============================================================

export async function putXml(
  env: TurnkeyStorageEnv,
  kind: TurnkeyXmlKind,
  invoiceNo: string,
  xml: string,
): Promise<PutResult> {
  const result = env.backend === 's3'
    ? await s3Put(env, kind, invoiceNo, xml)
    : await localPut(env, kind, invoiceNo, xml);
  logger.info('einvoice: wrote XML', { backend: env.backend, kind, invoiceNo, locator: result.locator });
  return result;
}

export async function listOutbound(env: TurnkeyStorageEnv): Promise<OutboundEntry[]> {
  return env.backend === 's3' ? s3List(env) : localList(env);
}

export async function readOutbound(env: TurnkeyStorageEnv, key: string): Promise<string> {
  return env.backend === 's3' ? s3Read(env, key) : localRead(env, key);
}

export async function markProcessed(env: TurnkeyStorageEnv, key: string): Promise<void> {
  return env.backend === 's3' ? s3MarkProcessed(env, key) : localMarkProcessed(env, key);
}

/** Helper：從 EinvoiceSettings 抽出 storage env，未設定的欄位 throw。 */
export function buildStorageEnv(cfg: {
  turnkeyBackend?: string;
  turnkeyInboundDir?: string;
  turnkeyOutboundDir?: string;
}): TurnkeyStorageEnv {
  const backend: TurnkeyBackend = cfg.turnkeyBackend === 's3' ? 's3' : 'local';
  return {
    backend,
    inboundDir: cfg.turnkeyInboundDir ?? '',
    outboundDir: cfg.turnkeyOutboundDir ?? '',
  };
}
