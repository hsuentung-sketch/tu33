import { describe, it, expect } from 'vitest';
import {
  generateDocumentNo,
  calculateDueDate,
  calculateTotals,
  getOverdueStatus,
  getTenantSettings,
} from '../src/shared/utils.js';

describe('generateDocumentNo', () => {
  it('formats YYYYMMDD + 3-digit sequence', () => {
    expect(generateDocumentNo(new Date(2026, 3, 13), 1)).toBe('20260413001');
  });

  it('zero-pads small dates and sequences', () => {
    expect(generateDocumentNo(new Date(2026, 0, 5), 7)).toBe('20260105007');
  });

  it('does not truncate sequences beyond 999', () => {
    expect(generateDocumentNo(new Date(2026, 0, 1), 1234)).toBe('202601011234');
  });
});

describe('calculateDueDate (Excel EOMONTH equivalent)', () => {
  it('March billing + 30 days → end of April', () => {
    expect(calculateDueDate(2026, 3, 30)).toEqual(new Date(2026, 3, 30, 23, 59, 59, 999));
  });

  it('March billing + 60 days → end of May', () => {
    expect(calculateDueDate(2026, 3, 60)).toEqual(new Date(2026, 4, 31, 23, 59, 59, 999));
  });

  it('March billing + 90 days → end of June', () => {
    expect(calculateDueDate(2026, 3, 90)).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
  });

  it('0-day payment terms → end of billing month', () => {
    expect(calculateDueDate(2026, 2, 0)).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
  });

  it('handles leap year February', () => {
    expect(calculateDueDate(2024, 2, 0)).toEqual(new Date(2024, 1, 29, 23, 59, 59, 999));
  });

  it('treats <30 days like 0 months (floor)', () => {
    expect(calculateDueDate(2026, 3, 29)).toEqual(calculateDueDate(2026, 3, 0));
  });

  it('crosses year boundary', () => {
    expect(calculateDueDate(2026, 11, 60)).toEqual(new Date(2027, 0, 31, 23, 59, 59, 999));
  });
});

describe('calculateTotals', () => {
  it('sums line items and applies 5% tax by default', () => {
    const r = calculateTotals([
      { quantity: 2, unitPrice: 17200 },
      { quantity: 1, unitPrice: 5000 },
    ]);
    expect(r.subtotal).toBe(39400);
    expect(r.taxAmount).toBe(1970);
    expect(r.totalAmount).toBe(41370);
  });

  it('rounds tax (bankers not used — Math.round half-to-even not guaranteed; just verify rounding)', () => {
    expect(calculateTotals([{ quantity: 1, unitPrice: 101 }]).taxAmount).toBe(5); // 5.05 → 5
    expect(calculateTotals([{ quantity: 1, unitPrice: 110 }]).taxAmount).toBe(6); // 5.5 → 6
  });

  it('accepts custom tax rate', () => {
    const r = calculateTotals([{ quantity: 10, unitPrice: 100 }], 0);
    expect(r.subtotal).toBe(1000);
    expect(r.taxAmount).toBe(0);
    expect(r.totalAmount).toBe(1000);
  });

  it('returns zero totals for empty items', () => {
    expect(calculateTotals([])).toEqual({ subtotal: 0, taxAmount: 0, totalAmount: 0 });
  });
});

describe('getOverdueStatus', () => {
  it('marks paid regardless of due date', () => {
    expect(getOverdueStatus(new Date(2020, 0, 1), true).level).toBe('paid');
  });

  it('returns overdue for past due dates', () => {
    const past = new Date(Date.now() - 10 * 86400000);
    const r = getOverdueStatus(past, false);
    expect(r.level).toBe('overdue');
    expect(r.message).toMatch(/已逾期/);
  });

  it('returns warning when within alert window', () => {
    const near = new Date(Date.now() + 5 * 86400000);
    expect(getOverdueStatus(near, false, 15).level).toBe('warning');
  });

  it('returns ok when beyond alert window', () => {
    const far = new Date(Date.now() + 30 * 86400000);
    expect(getOverdueStatus(far, false, 15).level).toBe('ok');
  });
});

describe('getTenantSettings', () => {
  it('returns defaults for null/undefined', () => {
    const s = getTenantSettings(null);
    expect(s.taxRate).toBe(0.05);
    expect(s.defaultPaymentDays).toBe(30);
  });

  it('merges user settings over defaults', () => {
    const s = getTenantSettings({ taxRate: 0.1, companyHeader: 'Foo' });
    expect(s.taxRate).toBe(0.1);
    expect(s.companyHeader).toBe('Foo');
    expect(s.overdueAlertDays).toBe(15); // default preserved
  });

  it('ignores non-objects', () => {
    expect(getTenantSettings('garbage').taxRate).toBe(0.05);
    expect(getTenantSettings(42).taxRate).toBe(0.05);
  });
});
