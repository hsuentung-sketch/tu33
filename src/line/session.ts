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
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
}

export interface Session {
  flow:
    | 'sales:create'
    | 'purchase:create'
    | 'quotation:create'
    | 'ocr:customer'
    | 'ar:pay'
    | 'ap:pay'
    | 'master:search'
    | 'master:product-list'
    | 'mgmt:emp:add'
    | 'mgmt:sup:add';
  step: 'party' | 'items' | 'confirm' | 'item-await-note' | 'await-delivery-note';
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
    searchMode?: 'customer' | 'product' | 'ar';
    /** For multi-step add flows (mgmt:emp:add, mgmt:sup:add). */
    pendingCreate?: { stage: string; draft: Record<string, any> };
    ocrCard?: OcrCard;
    /**
     * For 'master:product-list' flow: cached product id list so that
     * pagination postbacks don't re-query the whole table every page.
     * 30-min TTL is plenty for browsing.
     */
    productListIds?: string[];
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
