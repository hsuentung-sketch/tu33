import { endOfMonth, addMonths } from 'date-fns';

/**
 * Generate document number: YYYYMMDD + 3-digit sequence
 * Example: 20260413001
 */
export function generateDocumentNo(date: Date, sequence: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const seq = String(sequence).padStart(3, '0');
  return `${y}${m}${d}${seq}`;
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
  };
  if (typeof settings === 'object' && settings !== null) {
    return { ...defaults, ...(settings as Partial<TenantSettings>) };
  }
  return defaults;
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
}
