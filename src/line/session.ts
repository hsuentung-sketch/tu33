/**
 * In-memory conversation session keyed by (tenantId, lineUserId).
 * Good enough for a single-node deploy; swap for Redis if you scale out.
 */

export interface SessionItem {
  productName: string;
  quantity: number;
  unitPrice: number;
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
  flow: 'sales:create' | 'purchase:create' | 'quotation:create' | 'ocr:customer';
  step: 'party' | 'items' | 'confirm';
  data: {
    partyId?: string;
    partyName?: string;
    items: SessionItem[];
    pendingItem?: Partial<SessionItem>;
    ocrCard?: OcrCard;
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
