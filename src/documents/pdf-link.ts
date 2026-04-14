/**
 * Signed download links for generated PDFs.
 *
 * Used to give LINE users a clickable URL that downloads a PDF without
 * needing the LIFF id-token flow. Tokens are JWTs signed with JWT_SECRET
 * and carry the tenant + document kind/id + expiry.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export type PdfKind = 'quotation' | 'sales-order' | 'purchase-order';

interface PdfTokenPayload {
  t: string; // tenantId
  k: PdfKind;
  i: string; // document id
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function signPdfToken(
  tenantId: string,
  kind: PdfKind,
  id: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const payload: PdfTokenPayload = { t: tenantId, k: kind, i: id };
  return jwt.sign(payload, config.jwt.secret, { expiresIn: ttlSeconds });
}

export function verifyPdfToken(token: string): PdfTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as PdfTokenPayload;
    if (!decoded.t || !decoded.k || !decoded.i) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Build a public URL for a PDF download. `baseUrl` should be configured
 * via PUBLIC_BASE_URL env var (e.g. https://erp-line-bot.onrender.com).
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
