/**
 * In-memory conversation session keyed by (tenantId, lineUserId).
 * Good enough for a single-node deploy; swap for Redis if you scale out.
 */

export interface SessionItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  /** Optional free-form note captured via the 2026-04 item-note flow. */
  note?: string;
}

export interface OcrCard {
  companyName?: string;
  contactName?: string;
  /** 職稱（v2.10.0+） */
  title?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
}

/**
 * 快速建立傳票 session（v2.7.5+）：LINE 帳務選單 → 「新增傳票」
 * 兩條路徑（OCR / 手動）最終都收集 description / amount / paymentMethod 三欄
 * 然後呼叫後端 POST /api/accounting/expense/quick。
 */
export interface JeDraft {
  /** OCR 辨識結果（手動路徑為 undefined） */
  ocr?: {
    merchantName?: string;
    invoiceNo?: string;
    rawText?: string;
  };
  description?: string;
  amount?: number;
  invoiceDate?: string; // ISO yyyy-mm-dd；OCR 抽到的日期或預設今天
  paymentMethod?: 'cash' | 'bank' | 'payable';
  voucherNo?: string;
  /** ADMIN 可選 'posted'，ACCOUNTING 強制 'pending' */
  status?: 'pending' | 'posted';
}

export interface VisitLogDraft {
  visitDate?: string;        // ISO yyyy-mm-dd
  customerId?: string;
  customerName?: string;
  content?: string;
  nextActionDate?: string | null;
}

export interface Session {
  flow:
    | 'sales:create'
    | 'purchase:create'
    | 'quotation:create'
    | 'ocr:customer'
    | 'ocr:customer-edit'
    | 'ar:pay'
    | 'ap:pay'
    | 'master:search'
    | 'master:product-list'
    | 'mgmt:emp:add'
    | 'mgmt:sup:add'
    | 'je:create'
    | 'visitlog:create'
    | 'visitlog:search'
    | 'refurbish:create'
    | 'machine:register';
  step:
    | 'party' | 'items' | 'confirm' | 'item-await-note' | 'await-delivery-note'
    | 'machine-select-product' | 'machine-enter-serial' | 'machine-warranty-start' | 'machine-warranty-months'
    | 'je-method' | 'je-ocr-wait-image'
    | 'je-describe' | 'je-amount' | 'je-payment' | 'je-confirm'
    | 'visitlog-date' | 'visitlog-customer' | 'visitlog-content' | 'visitlog-next' | 'visitlog-confirm'
    | 'visitlog-search-customer'
    | 'ocr-edit-companyName' | 'ocr-edit-contactName' | 'ocr-edit-title'
    | 'ocr-edit-phone' | 'ocr-edit-taxId' | 'ocr-edit-email' | 'ocr-edit-address'
    | 'ocr-edit-confirm'
    | 'einvoice-carrier-menu' | 'einvoice-carrier-mobile' | 'einvoice-donation';
  data: {
    partyId?: string;
    partyName?: string;
    /** Delivery note collected once the item list is "完成". */
    deliveryNote?: string;
    items: SessionItem[];
    pendingItem?: Partial<SessionItem>;
    /**
     * Product the user just picked from a LINE search result. Next
     * numeric-looking text message is interpreted as "<qty>" (uses
     * salePrice/costPrice as default) or "<qty> <price>".
     */
    pendingProduct?: { name: string; salePrice: number; costPrice: number };
    /** For 'master:search' flow: which dataset to query next. */
    searchMode?: 'customer' | 'product' | 'ar' | 'customer-history' | 'product-customers';
    /** For multi-step add flows (mgmt:emp:add, mgmt:sup:add). */
    pendingCreate?: { stage: string; draft: Record<string, any> };
    ocrCard?: OcrCard;
    /** v2.9.0 逐欄編輯名片時，使用者編輯後的版本（與 ocrCard 並存以保留原值） */
    ocrCardDraft?: OcrCard;
    /**
     * For 'master:product-list' flow: cached product id list so that
     * pagination postbacks don't re-query the whole table every page.
     * 30-min TTL is plenty for browsing.
     */
    productListIds?: string[];
    /** v2.7.5: 快速建立傳票草稿 */
    jeDraft?: JeDraft;
    /** 整備工單 ID（refurbish:create flow） */
    refurbishOrderId?: string;
    refurbishMachineName?: string;
    /** 機台序號登記（machine:register flow） */
    machineSerial?: string;
    machineProductId?: string;
    machineProductName?: string;
    machineWarrantyStart?: string;
    /** v2.8.0: 工作日誌草稿 */
    visitDraft?: VisitLogDraft;
    /**
     * v2.12.0: 電子發票載具/捐贈暫存（銷貨流程 B2C 收集）。
     * 確認銷貨時寫進 SalesOrder.einvoice* 欄位，由後續發票開立步驟讀取。
     */
    einvoiceDraft?: {
      carrierType?: string;       // '3J0002' | 'CQ0001' | 'EJ0113'
      carrierId?: string;
      npoban?: string;
      printFlag?: 'Y' | 'N';
    };
  };
  updatedAt: number;
}

const STORE = new Map<string, Session>();
const TTL_MS = 30 * 60 * 1000; // 30 minutes

function key(tenantId: string, lineUserId: string): string {
  return `${tenantId}::${lineUserId}`;
}

function sweep(now: number): void {
  for (const [k, s] of STORE) {
    if (now - s.updatedAt > TTL_MS) STORE.delete(k);
  }
}

export function get(tenantId: string, lineUserId: string): Session | undefined {
  sweep(Date.now());
  return STORE.get(key(tenantId, lineUserId));
}

export function set(tenantId: string, lineUserId: string, session: Session): void {
  session.updatedAt = Date.now();
  STORE.set(key(tenantId, lineUserId), session);
}

export function clear(tenantId: string, lineUserId: string): void {
  STORE.delete(key(tenantId, lineUserId));
}

export function start(
  tenantId: string,
  lineUserId: string,
  flow: Session['flow'],
): Session {
  const s: Session = {
    flow,
    step: 'party',
    data: { items: [] },
    updatedAt: Date.now(),
  };
  STORE.set(key(tenantId, lineUserId), s);
  return s;
}
