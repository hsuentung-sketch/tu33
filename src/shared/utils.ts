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
 * Legacy signature — kept for callers that only have paymentDays.
 * Formula: EOMONTH(DATE(year, month, 1), floor(paymentDays/30))
 *   = end of (billing month + floor(paymentDays/30) months).
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
 * Calculate billing month + due date from an order date and the customer's
 * billing profile. Replaces the old EOMONTH-only formula with the standard
 * Taiwan B2B "結帳日 + 固定付款日" pattern.
 *
 * Steps:
 *  1. stmtDay = customer.statementDay ?? 31 (月底)
 *  2. orderDate.day ≤ stmtDay → 本月結；否則 +1 月（跨年自動 carry）
 *  3. monthsAdd = max(0, floor((paymentDays ?? 30) / 30))
 *  4. targetMonth = billingMonth + monthsAdd
 *  5. fixedPaymentDay 有值 → dueDate = (targetYear, targetMonth, clamp(fixedPaymentDay, 該月最後一日))
 *     否則 → dueDate = endOfMonth(targetYear, targetMonth, 1)
 *
 * Uses local time (Date getters) — caller is responsible for handing in
 * an `orderDate` representing the intended business day. Server-side
 * 自動分錄走 Asia/Taipei via `getBusinessDay` (見 timezone.ts) 前先 round。
 */
export function calculateBillingAndDueDate(
  orderDate: Date,
  customer: {
    paymentDays?: number | null;
    statementDay?: number | null;
    fixedPaymentDay?: number | null;
  },
): { billingYear: number; billingMonth: number; dueDate: Date } {
  const stmtDay = clampDay(customer.statementDay ?? 31);
  const orderDay = orderDate.getDate();
  let billingYear = orderDate.getFullYear();
  let billingMonth = orderDate.getMonth() + 1; // 1-12
  if (orderDay > stmtDay) {
    billingMonth += 1;
    if (billingMonth > 12) {
      billingMonth = 1;
      billingYear += 1;
    }
  }

  const paymentDays = customer.paymentDays ?? 30;
  const monthsAdd = Math.max(0, Math.floor(paymentDays / 30));

  // Compute target year/month after adding monthsAdd
  let targetYear = billingYear;
  let targetMonth = billingMonth + monthsAdd;
  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }

  let dueDate: Date;
  if (customer.fixedPaymentDay && customer.fixedPaymentDay > 0) {
    const lastDay = new Date(targetYear, targetMonth, 0).getDate(); // day 0 of next month = last day of this month
    const day = Math.min(clampDay(customer.fixedPaymentDay), lastDay);
    dueDate = new Date(targetYear, targetMonth - 1, day);
  } else {
    dueDate = endOfMonth(new Date(targetYear, targetMonth - 1, 1));
  }

  return { billingYear, billingMonth, dueDate };
}

function clampDay(d: number): number {
  if (!Number.isFinite(d)) return 31;
  if (d < 1) return 1;
  if (d > 31) return 31;
  return Math.floor(d);
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
    invoiceStamp: { ...stampDefaults },
    accounting: { ...accountingDefaults },
  };
  if (typeof settings === 'object' && settings !== null) {
    const raw = settings as Partial<TenantSettings>;
    return {
      ...defaults,
      ...raw,
      einvoice: { ...einvoiceDefaults, ...(raw.einvoice ?? {}) },
      invoiceStamp: { ...stampDefaults, ...(raw.invoiceStamp ?? {}) },
      accounting: { ...accountingDefaults, ...(raw.accounting ?? {}) },
    };
  }
  return defaults;
}

const accountingDefaults: AccountingSettings = {
  enabled: false,
  fiscalYearStartMonth: 1,
  currentYear: new Date().getFullYear(),
  autoJournalEnabled: true,
  openingBalanceDone: false,
};

export interface AccountingSettings {
  /** 會計模組總開關。false 時自動分錄全部 skip，後台會計頁顯示「未啟用」。 */
  enabled: boolean;
  /** 會計年度起始月份（1-12），預設 1（Calendar Year） */
  fiscalYearStartMonth: number;
  /** 當前會計年度，啟用時建立 12 個 FiscalPeriod */
  currentYear: number;
  /** 自動分錄是否啟用；關閉只允許手動傳票 */
  autoJournalEnabled: boolean;
  /** 期初餘額是否已建立 */
  openingBalanceDone: boolean;
}

const stampDefaults: InvoiceStampSettings = {
  hasStamp: false,
  uploadedAt: '',
  opacity: 0.85,
};

export interface InvoiceStampSettings {
  /** 是否已上傳發票章圖檔（實際 PNG 存於 /data/stamps/<tenantId>.png） */
  hasStamp: boolean;
  /** ISO 字串，前端可拿來當 cache buster */
  uploadedAt: string;
  /** PDF 上蓋章半透明度，0–1，預設 0.85 */
  opacity: number;
}

const einvoiceDefaults: EinvoiceSettings = {
  enabled: false,
  sellerTaxId: '',
  sellerName: '',
  sellerAddress: '',
  taxRegistrationNo: '',
  turnkeyInboundDir: '',
  turnkeyOutboundDir: '',
  turnkeyOnlineCode: '',
  qrAesKey: '',
  defaultTaxType: '1',
  enableCarrier: true,
  enableDonation: true,
  defaultPrintFlag: 'Y',
};

export interface EinvoiceSettings {
  enabled: boolean;
  sellerTaxId: string;
  sellerName: string;
  /** 證明聯左側欄顯示的賣方地址 */
  sellerAddress: string;
  /** 稅籍編號（字軌申請書欄位） */
  taxRegistrationNo: string;
  turnkeyInboundDir: string;
  turnkeyOutboundDir: string;
  /** Turnkey 整合服務平台上線通行碼 */
  turnkeyOnlineCode: string;
  /** AES-128 金鑰（hex 32 字元），整合平台下載，用於證明聯 QR 加密驗證 */
  qrAesKey: string;
  /** 1=應稅 2=零稅率 3=免稅 */
  defaultTaxType: string;
  /** 開立 B2C 時是否允許輸入載具 */
  enableCarrier: boolean;
  /** 開立 B2C 時是否允許捐贈碼 */
  enableDonation: boolean;
  /** 預設是否列印證明聯：Y=列印 N=不列印（B2C 載具/捐贈時通常 N） */
  defaultPrintFlag: string;
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
  invoiceStamp: InvoiceStampSettings;
  accounting: AccountingSettings;
}
