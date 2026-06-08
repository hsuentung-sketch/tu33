/**
 * Signed download links for product / supplier documents (v2.16.0+).
 *
 * Replaces the old Supabase-signed-URL approach. Works the same way as
 * pdf-link.ts: a short-lived JWT carries (tenantId, kind, docId) and the
 * public /doc endpoint verifies it before streaming the file.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export type DocKind = 'product' | 'supplier';

interface DocTokenPayload {
  t: string;  // tenantId
  k: DocKind;
  i: string;  // document id
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function signDocToken(
  tenantId: string,
  kind: DocKind,
  id: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const payload: DocTokenPayload = { t: tenantId, k: kind, i: id };
  return jwt.sign(payload, config.jwt.secret, { expiresIn: ttlSeconds });
}

export function verifyDocToken(token: string): DocTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as DocTokenPayload;
    if (!decoded.t || !decoded.k || !decoded.i) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Build a public download URL for a document file.
 */
export function buildDocUrl(
  baseUrl: string,
  kind: DocKind,
  id: string,
  token: string,
): string {
  const path = `/doc/${kind}/${encodeURIComponent(id)}`;
  return `${baseUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}
