import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/index.js', () => ({
  config: { jwt: { secret: 'test-secret-for-session-confusion' }, nodeEnv: 'test' },
}));

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('../src/shared/prisma.js', () => ({ prisma: { employee: { findFirst } } }));
vi.mock('../src/modules/core/auth/liff-auth.middleware.js', () => ({ liffAuthMiddleware: vi.fn() }));
vi.mock('../src/shared/audit.js', () => ({
  runWithAuditContext: async (_c: unknown, fn: () => Promise<void>) => fn(),
}));
vi.mock('../src/shared/error-log.js', () => ({ updateRequestContext: vi.fn() }));

import { authMiddleware } from '../src/modules/core/auth/auth.middleware.js';
import { signTyped } from '../src/shared/typed-jwt.js';
import { signSessionToken } from '../src/modules/core/auth/session-token.js';

function run(cookie: string) {
  const req: any = { headers: {}, header: () => undefined, cookies: { ep_session: cookie } };
  const next = vi.fn();
  return authMiddleware(req, {} as any, next).then(() => ({ req, next }));
}

describe('cookie session auth — token type confusion', () => {
  beforeEach(() => findFirst.mockReset());

  it('REGRESSION: PDF download token as ep_session → 401 and NO employee lookup', async () => {
    const pdf = signTyped('pdf', { t: 'tenantA', k: 'quotation', i: 'q1' }, '7d');
    const { next } = await run(pdf);
    expect(findFirst).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]?.statusCode ?? next.mock.calls[0][0]?.status).toBe(401);
  });

  it('doc download token as ep_session → 401 and NO employee lookup', async () => {
    const doc = signTyped('doc', { t: 'tenantA', k: 'bank-doc', i: 'file' }, '7d');
    const { next } = await run(doc);
    expect(findFirst).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeTruthy();
  });

  it('a genuine session token still authenticates, with BOTH ids in the lookup', async () => {
    findFirst.mockResolvedValue({
      id: 'e1', tenantId: 't1', employeeId: 'E0001', name: 'A', role: 'ADMIN', lineUserId: null,
      isActive: true, tenant: { isActive: true, settings: {} },
    });
    const token = signSessionToken({ employeeId: 'e1', tenantId: 't1', role: 'ADMIN' }, 12);
    const { req, next } = await run(token);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 'e1', tenantId: 't1', isActive: true });
    expect(next).toHaveBeenCalledWith(); // no error
    expect(req.tenantId).toBe('t1');
  });
});
