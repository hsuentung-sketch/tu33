/**
 * Turnkey writer — 把 MIG XML 寫入 Turnkey 整合服務的 inbound 位置。
 *
 * v2.11.0 起改走 `turnkey-storage.ts` 介面，支援 local FS 與 S3-compatible
 * object storage 兩種 backend。預設仍是 local，由 tenant.settings.einvoice.turnkeyBackend
 * 切換成 's3' 後才走 S3。
 *
 * 呼叫端介面（writeIssueXml / writeVoidXml）維持不變，避免 ripple change。
 */
import { ValidationError } from '../../../shared/errors.js';
import { buildStorageEnv, putXml } from './turnkey-storage.js';

export interface WriteResult {
  /** local：絕對檔案路徑；s3：bucket 內 key */
  absolutePath: string;
}

export interface TurnkeyEnvInput {
  /** 'local' | 's3'，預設 'local' */
  backend?: string;
  /** local：絕對路徑；s3：prefix（如 `tenant-abc/inbound/`） */
  inboundDir: string;
  outboundDir?: string;
}

/** 舊呼叫端用 `{ inboundDir, invoiceNo, xml }` 形式，仍相容。 */
interface LegacyOpts {
  inboundDir: string;
  invoiceNo: string;
  xml: string;
  /** 可選：完整 env（含 backend / outboundDir）。沒給就當 local + 用 inboundDir */
  env?: TurnkeyEnvInput;
}

function envOf(opts: LegacyOpts) {
  if (opts.env) {
    return buildStorageEnv({
      turnkeyBackend: opts.env.backend,
      turnkeyInboundDir: opts.env.inboundDir,
      turnkeyOutboundDir: opts.env.outboundDir,
    });
  }
  if (!opts.inboundDir) {
    throw new ValidationError('Turnkey inbound 目錄未設定（Tenant.settings.einvoice.turnkeyInboundDir）');
  }
  return buildStorageEnv({
    turnkeyBackend: 'local',
    turnkeyInboundDir: opts.inboundDir,
    turnkeyOutboundDir: '',
  });
}

export async function writeIssueXml(opts: LegacyOpts): Promise<WriteResult> {
  const env = envOf(opts);
  const { locator } = await putXml(env, 'C0401', opts.invoiceNo, opts.xml);
  return { absolutePath: locator };
}

export async function writeVoidXml(opts: LegacyOpts): Promise<WriteResult> {
  const env = envOf(opts);
  const { locator } = await putXml(env, 'C0501', opts.invoiceNo, opts.xml);
  return { absolutePath: locator };
}

/** 折讓單 D0401 / D0501。 */
export async function writeAllowanceXml(opts: LegacyOpts & { kind: 'D0401' | 'D0501' }): Promise<WriteResult> {
  const env = envOf(opts);
  const { locator } = await putXml(env, opts.kind, opts.invoiceNo, opts.xml);
  return { absolutePath: locator };
}
