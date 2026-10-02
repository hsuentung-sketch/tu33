/**
 * Typed JWTs — one signing secret, but every token carries a `typ` claim and every
 * verifier states which type it accepts.
 *
 * Why: session cookies, PDF links and document links are all signed with JWT_SECRET.
 * Without a type check, a PDF link (handed out via LINE, valid 7 days) could be
 * replayed as the `ep_session` cookie. Its payload has no employeeId/tenantId, so
 * the Prisma lookup dropped both filters and matched an arbitrary active employee.
 *
 * Legacy tokens (issued before `typ` existed) are still accepted when their payload
 * has the exact shape the verifier expects — existing LINE links and sessions keep
 * working. Remove the legacy branch once every pre-typ token has expired
 * (PDF/doc links live 7 days; sessions 12h): after 2026-10-12 at the latest.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export type TokenType = 'session' | 'pdf' | 'doc';

const ALGORITHMS: jwt.Algorithm[] = ['HS256'];

export function signTyped(
  type: TokenType,
  payload: Record<string, unknown>,
  expiresIn: jwt.SignOptions['expiresIn'],
): string {
  return jwt.sign({ ...payload, typ: type }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn,
  });
}

/**
 * Verify a token and return its payload, or null when the token is invalid, expired,
 * of a different type, or fails `isValidShape`. Never throws.
 */
export function verifyTyped<T extends Record<string, unknown> = Record<string, unknown>>(
  type: TokenType,
  token: string,
  isValidShape: (payload: Record<string, unknown>) => boolean,
): T | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ALGORITHMS });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const payload = decoded as Record<string, unknown>;
    // Present-but-different `typ` is always rejected; absent `typ` = legacy token.
    if (payload.typ !== undefined && payload.typ !== type) return null;
    if (!isValidShape(payload)) return null;
    return payload as T;
  } catch {
    return null;
  }
}
