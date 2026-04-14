import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

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

  // Purchase
  'purchaseOrder:created': { tenantId: string; purchaseOrderId: string; supplierId: string };
  'purchaseOrder:approved': { tenantId: string; purchaseOrderId: string; approvedBy: string };
  'purchaseOrder:completed': { tenantId: string; purchaseOrderId: string };
  'purchaseOrder:cancelled': { tenantId: string; purchaseOrderId: string; reason: string };

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
}

export type ERPEvent = keyof ERPEventMap;

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
        logger.error(`Event handler error [${event}]`, { error: err });
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
        logger.error(`Event handler error [${event}]`, { error: err });
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
