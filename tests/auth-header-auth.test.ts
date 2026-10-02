import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirst, cfg } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  cfg: { jwt: { secret: 'test-secret-header-auth' }, nodeEnv: 'test', internalApiKey: '' },
}));

vi.mock('../src/config/index.js', () => ({ config: cfg }));
vi.mock('../src/shared/prisma.js', () => ({ prisma: { employee: { findFirst } } }));
vi.mock('../src/modules/core/auth/liff-auth.middleware.js', () => ({ liffAuthMiddleware: vi.fn() }));
vi.mock('../src/shared/audit.js', () => ({
  runWithAuditContext: async (_c: unknown, fn: () => Promise<void>) => fn(),
}));
vi.mock('../src/shared/error-log.js', () => ({ updateRequestContext: vi.fn() }));

import { authMiddleware } from '../src/modules/core/auth/auth.middleware.js';

const employee = {
  id: 'e1', tenantId: 't1', employeeId: 'E0001', name: 'A', role: 'ADMIN', lineUserId: null,
  isActive: true, tenant: { isActive: true, settings: {} },
};

function run(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req: any = { headers: lower, header: (n: string) => lower[n.toLowerCase()], cookies: {} };
  const next = vi.fn();
  return authMiddleware(req, {} as any, next).then(() => ({ req, next }));
}

const IDS = { 'x-tenant-id': 't1', 'x-employee-id': 'e1' };

describe('header auth (x-tenant-id + x-employee-id)', () => {
  beforeEach(() => {
    findFirst.mockReset();
    findFirst.mockResolvedValue(employee);
    cfg.internalApiKey = '';
  });

  it('REGRESSION: ids alone must NOT authenticate (ids are identifiers, not credentials)', async () => {
    cfg.internalApiKey = 'internal-key-1234567890';
    const { next } = await run(IDS);
    expect(findFirst).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]?.statusCode ?? next.mock.calls[0][0]?.status).toBe(401);
  });

  it('is disabled entirely when INTERNAL_API_KEY is not configured (fail closed)', async () => {
    cfg.internalApiKey = '';
    const { next } = await run({ ...IDS, 'x-internal-key': '' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeTruthy();
  });

  it('rejects a wrong key, including one of a different length', async () => {
    cfg.internalApiKey = 'internal-key-1234567890';
    for (const bad of ['wrong', 'internal-key-1234567891', 'internal-key-1234567890-extra']) {
      findFirst.mockClear();
      const { next } = await run({ ...IDS, 'x-internal-key': bad });
      expect(findFirst).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeTruthy();
    }
  });

  it('accepts ids + the correct key, and looks the employee up by BOTH ids', async () => {
    cfg.internalApiKey = 'internal-key-1234567890';
    const { req, next } = await run({ ...IDS, 'x-internal-key': 'internal-key-1234567890' });
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 'e1', tenantId: 't1', isActive: true });
    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe('t1');
  });

  it('still rejects a correct key when an id is missing', async () => {
    cfg.internalApiKey = 'internal-key-1234567890';
    const { next } = await run({ 'x-tenant-id': 't1', 'x-internal-key': 'internal-key-1234567890' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeTruthy();
  });
});
