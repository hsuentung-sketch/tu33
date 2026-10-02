import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../src/config/index.js', () => ({
  config: { jwt: { secret: 'test-secret-for-typed-jwt' } },
}));

import { signTyped, verifyTyped } from '../src/shared/typed-jwt.js';

const SECRET = 'test-secret-for-typed-jwt';

const isSession = (p: Record<string, unknown>) =>
  typeof p.employeeId === 'string' && typeof p.tenantId === 'string';
const isPdf = (p: Record<string, unknown>) =>
  typeof p.t === 'string' && typeof p.k === 'string' && typeof p.i === 'string';

describe('typed-jwt', () => {
  it('round-trips a session token', () => {
    const token = signTyped('session', { employeeId: 'e1', tenantId: 't1' }, '1h');
    const p = verifyTyped('session', token, isSession);
    expect(p).toMatchObject({ employeeId: 'e1', tenantId: 't1', typ: 'session' });
  });

  it('REGRESSION: a PDF download token must not authenticate as a session', () => {
    // PDF payload has no employeeId/tenantId → previously Prisma dropped the
    // undefined filters and findFirst({isActive:true}) returned an arbitrary employee.
    const pdfToken = signTyped('pdf', { t: 'tenantA', k: 'quotation', i: 'q1' }, '7d');
    expect(verifyTyped('session', pdfToken, isSession)).toBeNull();
  });

  it('rejects a legacy (no typ) PDF token as a session', () => {
    const legacyPdf = jwt.sign({ t: 'tenantA', k: 'quotation', i: 'q1' }, SECRET, { expiresIn: '7d' });
    expect(verifyTyped('session', legacyPdf, isSession)).toBeNull();
  });

  it('rejects a session token used as a PDF token', () => {
    const session = signTyped('session', { employeeId: 'e1', tenantId: 't1' }, '1h');
    expect(verifyTyped('pdf', session, isPdf)).toBeNull();
  });

  it('still accepts legacy tokens without typ when the shape matches (outstanding LINE links / sessions)', () => {
    const legacyPdf = jwt.sign({ t: 'tenantA', k: 'quotation', i: 'q1' }, SECRET, { expiresIn: '7d' });
    expect(verifyTyped('pdf', legacyPdf, isPdf)).toMatchObject({ t: 'tenantA', i: 'q1' });
    const legacySession = jwt.sign({ employeeId: 'e1', tenantId: 't1', role: 'ADMIN' }, SECRET, { expiresIn: '1h' });
    expect(verifyTyped('session', legacySession, isSession)).toMatchObject({ employeeId: 'e1' });
  });

  it('rejects a token whose typ is a different type even if the shape would fit', () => {
    const forged = jwt.sign({ typ: 'pdf', employeeId: 'e1', tenantId: 't1' }, SECRET, { expiresIn: '1h' });
    expect(verifyTyped('session', forged, isSession)).toBeNull();
  });

  it('rejects empty-string ids', () => {
    const t = jwt.sign({ typ: 'session', employeeId: '', tenantId: 't1' }, SECRET, { expiresIn: '1h' });
    expect(verifyTyped('session', t, (p) => isSession(p) && !!p.employeeId && !!p.tenantId)).toBeNull();
  });

  it('rejects alg=none and non-HS256 algorithms', () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ typ: 'session', employeeId: 'e1', tenantId: 't1' }),
    ).toString('base64url')}.`;
    expect(verifyTyped('session', none, isSession)).toBeNull();
    const hs512 = jwt.sign({ typ: 'session', employeeId: 'e1', tenantId: 't1' }, SECRET, { algorithm: 'HS512' });
    expect(verifyTyped('session', hs512, isSession)).toBeNull();
  });

  it('rejects expired, tampered and wrong-secret tokens', () => {
    const expired = jwt.sign({ typ: 'session', employeeId: 'e1', tenantId: 't1' }, SECRET, { expiresIn: -10 });
    expect(verifyTyped('session', expired, isSession)).toBeNull();
    const wrongSecret = jwt.sign({ typ: 'session', employeeId: 'e1', tenantId: 't1' }, 'other-secret');
    expect(verifyTyped('session', wrongSecret, isSession)).toBeNull();
    const good = signTyped('session', { employeeId: 'e1', tenantId: 't1' }, '1h');
    expect(verifyTyped('session', good.slice(0, -2) + 'xx', isSession)).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(verifyTyped('session', '', isSession)).toBeNull();
    expect(verifyTyped('session', 'not-a-jwt', isSession)).toBeNull();
  });
});
