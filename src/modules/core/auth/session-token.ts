/**
 * Web-console session token (the `ep_session` cookie). Typed so that other JWTs signed
 * with the same secret (PDF / document download links) can never be replayed as a session.
 */
import { signTyped, verifyTyped } from '../../../shared/typed-jwt.js';

export interface SessionTokenPayload {
  employeeId: string;
  tenantId: string;
  role?: string;
}

const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

export function signSessionToken(
  payload: { employeeId: string; tenantId: string; role: string },
  ttlHours: number,
): string {
  return signTyped('session', { ...payload }, `${ttlHours}h`);
}

/** Returns the payload only when it is a genuine session token with non-empty ids. */
export function verifySessionToken(token: string): SessionTokenPayload | null {
  return verifyTyped<SessionTokenPayload & Record<string, unknown>>(
    'session',
    token,
    (p) => nonEmptyString(p.employeeId) && nonEmptyString(p.tenantId),
  );
}
