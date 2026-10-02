import { EventEmitter } from 'node:events';
import { logger } from './logger.js';
import { writeErrorLog } from './error-log.js';

// ─── Event payload map ───────────────────────────────────────────────
// Add new domain events here so listeners and emitters stay type-safe.

export interface ERPEventMap {
  // Sales
  'quotation:created': { tenantId: string; quotationId: string; customerId: string };
  'quotation:approved': { tenantId: string; quotationId: string; approvedBy: string };
  'quotation:won': { tenantId: string; quotationId: string; salesOrderId: string };
  'quotation:lost': { tenantId: string; quotationId: string; reason?: string };

  // Sales Orders
  'salesOrder:created': { tenantId: string; salesOrderId: string; quotationId?: string };
  'salesOrder:confirmed': { tenantId: string; salesOrderId: string };
  'salesOrder:shipped': { tenantId: string; salesOrderId: string; shipmentId: string };
  'salesOrder:completed': { tenantId: string; salesOrderId: string };
  'salesOrder:cancelled': { tenantId: string; salesOrderId: string; reason: string };
  'salesOrder:updated': { tenantId: string; salesOrderId: string; actorId: string };
  'salesOrder:deleted': { tenantId: string; salesOrderId: string; actorId: string };

  // Purchase
  'purchaseOrder:created': { tenantId: string; purchaseOrderId: string; supplierId: string };
  'purchaseOrder:approved': { tenantId: string; purchaseOrderId: string; approvedBy: string };
  'purchaseOrder:completed': { tenantId: string; purchaseOrderId: string };
  'purchaseOrder:cancelled': { tenantId: string; purchaseOrderId: string; reason: string };
  'purchaseOrder:updated': { tenantId: string; purchaseOrderId: string; actorId: string };
  'purchaseOrder:deleted': { tenantId: string; purchaseOrderId: string; actorId: string };

  // Inventory
  'inventory:adjusted': {
    tenantId: string;
    productId: string;
    warehouseId?: string;
    delta: number;
    reason: string;
    quantity: number;
    refType?: string;
    refId?: string;
  };
  'inventory:lowStock': { tenantId: string; productId: string; currentQty: number; reorderPoint: number };

  // Accounting
  'invoice:created': { tenantId: string; invoiceId: string; salesOrderId?: string };
  'invoice:paid': { tenantId: string; invoiceId: string; amount: number };
  'payment:received': { tenantId: string; paymentId: string; invoiceId: string; amount: number };
  /** 應收由已收改回未收（invoiceId = AR id） */
  'invoice:unpaid': { tenantId: string; invoiceId: string; actorId?: string };
  /** 應付由已付改回未付（paymentId = AP id） */
  'payment:unpaid': { tenantId: string; paymentId: string; actorId?: string };
}

export type ERPEvent = keyof ERPEventMap;

// 事件處理失敗不中斷主流程，但要留在後台「錯誤紀錄」，否則自動傳票等副作用會無聲遺失。
function reportHandlerError(event: ERPEvent, payload: unknown, err: unknown): void {
  logger.error(`Event handler error [${event}]`, { error: err });
  const e = err as Error;
  void writeErrorLog({
    source: `event:${event}`,
    message: e?.message ?? String(err),
    stack: e?.stack ?? null,
    tenantId: (payload as { tenantId?: string })?.tenantId ?? null,
    context: { payload: payload as Record<string, unknown> },
  });
}

// ─── Typed event bus ─────────────────────────────────────────────────

export class ERPEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Raise the default limit — ERP modules can register many listeners.
    this.emitter.setMaxListeners(100);
  }

  /**
   * Subscribe to a domain event.
   * Returns an unsubscribe function for easy cleanup.
   */
  on<E extends ERPEvent>(event: E, handler: (payload: ERPEventMap[E]) => void | Promise<void>): () => void {
    const wrapped = async (payload: ERPEventMap[E]) => {
      try {
        await handler(payload);
      } catch (err) {
        reportHandlerError(event, payload, err);
      }
    };
    this.emitter.on(event, wrapped as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(event, wrapped as (...args: unknown[]) => void);
    };
  }

  /**
   * Subscribe to a domain event, auto-removing after the first invocation.
   */
  once<E extends ERPEvent>(event: E, handler: (payload: ERPEventMap[E]) => void | Promise<void>): void {
    const wrapped = async (payload: ERPEventMap[E]) => {
      try {
        await handler(payload);
      } catch (err) {
        reportHandlerError(event, payload, err);
      }
    };
    this.emitter.once(event, wrapped as (...args: unknown[]) => void);
  }

  /**
   * Emit a domain event. All registered handlers are invoked asynchronously.
   */
  emit<E extends ERPEvent>(event: E, payload: ERPEventMap[E]): void {
    logger.info(`Event emitted: ${event}`, { event, payload });
    this.emitter.emit(event, payload);
  }

  /**
   * Emit and await all registered async handlers.
   * Use when callers need handler side-effects to complete before continuing
   * (e.g. tests, or services that must observe downstream state).
   */
  async emitAsync<E extends ERPEvent>(event: E, payload: ERPEventMap[E]): Promise<void> {
    logger.info(`Event emitted: ${event}`, { event, payload });
    const listeners = this.emitter.listeners(event) as Array<(p: ERPEventMap[E]) => unknown>;
    await Promise.all(listeners.map((l) => Promise.resolve(l(payload))));
  }

  /**
   * Remove all listeners for a specific event, or all events if none specified.
   */
  removeAllListeners(event?: ERPEvent): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Return the number of listeners currently registered for an event.
   */
  listenerCount(event: ERPEvent): number {
    return this.emitter.listenerCount(event);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

export const eventBus = new ERPEventBus();
