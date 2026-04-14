import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as session from '../src/line/session.js';

describe('session store', () => {
  const tenantId = 't1';
  const userId = 'U-abc';

  beforeEach(() => {
    session.clear(tenantId, userId);
  });

  it('start creates a new session in party step with empty items', () => {
    const s = session.start(tenantId, userId, 'sales:create');
    expect(s.flow).toBe('sales:create');
    expect(s.step).toBe('party');
    expect(s.data.items).toEqual([]);
  });

  it('get returns the same session', () => {
    session.start(tenantId, userId, 'sales:create');
    const s = session.get(tenantId, userId);
    expect(s?.flow).toBe('sales:create');
  });

  it('set updates the updatedAt timestamp', () => {
    const s = session.start(tenantId, userId, 'sales:create');
    const t0 = s.updatedAt;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 1000));
    s.step = 'items';
    session.set(tenantId, userId, s);
    const refreshed = session.get(tenantId, userId);
    expect(refreshed?.updatedAt).toBeGreaterThan(t0);
    vi.useRealTimers();
  });

  it('clear removes the session', () => {
    session.start(tenantId, userId, 'sales:create');
    session.clear(tenantId, userId);
    expect(session.get(tenantId, userId)).toBeUndefined();
  });

  it('isolates sessions by tenant and user', () => {
    session.start('t1', 'U1', 'sales:create');
    session.start('t1', 'U2', 'purchase:create');
    session.start('t2', 'U1', 'quotation:create');
    expect(session.get('t1', 'U1')?.flow).toBe('sales:create');
    expect(session.get('t1', 'U2')?.flow).toBe('purchase:create');
    expect(session.get('t2', 'U1')?.flow).toBe('quotation:create');
    session.clear('t1', 'U1');
    session.clear('t1', 'U2');
    session.clear('t2', 'U1');
  });

  it('sweeps sessions older than 30 minutes', () => {
    vi.useFakeTimers();
    const start = new Date('2026-04-14T10:00:00Z');
    vi.setSystemTime(start);
    session.start(tenantId, userId, 'sales:create');
    expect(session.get(tenantId, userId)).toBeDefined();
    // Jump 31 minutes forward
    vi.setSystemTime(new Date(start.getTime() + 31 * 60 * 1000));
    expect(session.get(tenantId, userId)).toBeUndefined();
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
