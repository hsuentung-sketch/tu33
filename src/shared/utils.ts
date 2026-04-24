import { endOfMonth, addMonths } from 'date-fns';
import { taipeiDateStamp } from './timezone.js';

/**
 * Generate document number: YYYYMMDD (Asia/Taipei) + 3-digit sequence
 * Example: 20260413001
 *
 * IMPORTANT: the YYYYMMDD portion is the Taipei calendar date, not the
 * server's UTC date. A sale at 01:00 Taipei time (= 17:00 UTC previous day)
 * must produce a number with today's Taipei date.
 */
export function generateDocumentNo(date: Date, sequence: number): string {
  const stamp = taipeiDateStamp(date);
  const seq = String(sequence).padStart(3, '0');
  return `${stamp}${seq}`;
}

/**
 * Calculate payment due date (from Excel formula):
 * EOMONTH(DATE(year, month, 1), paymentDays/30)
 *
 * Meaning: end of month of (billing month + floor(paymentDays/30) months)
 * Example: March billing, 30 days → end of April (2026/4/30)
 * Example: March billing, 60 days → end of May (2026/5/31)
 */
export function calculateDueDate(
  billingYear: number,
  billingMonth: number,
  paymentDays: number,
): Date {
  const baseDate = new Date(billingYear, billingMonth - 1, 1);
  const monthsToAdd = Math.floor(paymentDays / 30);
  return endOfMonth(addMonths(baseDate, monthsToAdd));
}

/**
 * Calculate overdue status for display
 */
export function getOverdueStatus(
  dueDate: Date,
  isPaid: boolean,
  alertDays: number = 15,
): { level: 'ok' | 'warning' | 'overdue' | 'paid'; message: string } {
  if (isPaid) {
    return { level: 'paid', message: '已結案' };
  }

  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { level: 'overdue', message: `已逾期 ${Math.abs(diffDays)} 天` };
  }
  if (diffDays <= alertDays) {
    return { level: 'warning', message: `剩餘 ${diffDays} 天到期` };
  }
  return { level: 'ok', message: `${diffDays} 天後到期` };
}

/**
 * Calculate subtotal, tax, and total
 */
export function calculateTotals(
  items: Array<{ quantity: number; unitPrice: number }>,
  taxRate: number = 0.05,
): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxAmount = Math.round(subtotal * taxRate);
  const totalAmount = subtotal + taxAmount;
  return { subtotal, taxAmount, totalAmount };
}

/**
 * Get tenant settings with defaults
 */
export function getTenantSettings(settings: unknown): TenantSettings {
  const defaults: TenantSettings = {
    taxRate: 0.05,
    currency: 'TWD',
    quotationPrefix: 'Q',
    salesPrefix: 'S',
    purchasePrefix: 'P',
    defaultPaymentDays: 30,
    overdueAlertDays: 15,
    companyHeader: '',
    pdfFooter: '',
    einvoice: { ...einvoiceDefaults },
  };
  if (typeof settings === 'object' && settings !== null) {
    const raw = settings as Partial<TenantSettings>;
    return {
      ...defaults,
      ...raw,
      einvoice: { ...einvoiceDefaults, ...(raw.einvoice ?? {}) },
    };
  }
  return defaults;
}

const einvoiceDefaults: EinvoiceSettings = {
  enabled: false,
  sellerTaxId: '',
  sellerName: '',
  turnkeyInboundDir: '',
  turnkeyOutboundDir: '',
  defaultTaxType: '1',
};

export interface EinvoiceSettings {
  enabled: boolean;
  sellerTaxId: string;
  sellerName: string;
  turnkeyInboundDir: string;
  turnkeyOutboundDir: string;
  /** 1=應稅 2=零稅率 3=免稅 */
  defaultTaxType: string;
}

export interface TenantSettings {
  taxRate: number;
  currency: string;
  quotationPrefix: string;
  salesPrefix: string;
  purchasePrefix: string;
  defaultPaymentDays: number;
  overdueAlertDays: number;
  companyHeader: string;
  pdfFooter: string;
  einvoice: EinvoiceSettings;
}
