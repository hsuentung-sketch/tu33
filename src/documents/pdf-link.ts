/**
 * Signed download links for generated PDFs.
 *
 * Used to give LINE users a clickable URL that downloads a PDF without
 * needing the LIFF id-token flow. Tokens are JWTs signed with JWT_SECRET
 * and carry the tenant + document kind/id + expiry.
 */
import { signTyped, verifyTyped } from '../shared/typed-jwt.js';

export type PdfKind = 'quotation' | 'sales-order' | 'purchase-order';

interface PdfTokenPayload {
  t: string; // tenantId
  k: PdfKind;
  i: string; // document id
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

export function signPdfToken(
  tenantId: string,
  kind: PdfKind,
  id: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const payload: PdfTokenPayload = { t: tenantId, k: kind, i: id };
  return signTyped('pdf', { ...payload }, ttlSeconds);
}

export function verifyPdfToken(token: string): PdfTokenPayload | null {
  return verifyTyped<PdfTokenPayload & Record<string, unknown>>(
    'pdf',
    token,
    (p) => nonEmptyString(p.t) && nonEmptyString(p.k) && nonEmptyString(p.i),
  );
}

/**
 * Build a public URL for a PDF download. `baseUrl` should be configured
 * via PUBLIC_BASE_URL env var (e.g. https://erp-line-bot.fly.dev).
 */
export function buildPdfUrl(
  baseUrl: string,
  kind: PdfKind,
  id: string,
  token: string,
): string {
  const path = `/pdf/${kind}/${encodeURIComponent(id)}`;
  return `${baseUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}
