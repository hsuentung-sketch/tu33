import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/shared/prisma.js';
import * as salesOrderService from '../../src/modules/sales/sales-order/sales-order.service.js';
import { registerInventoryEventHandlers } from '../../src/modules/inventory/inventory.events.js';
import { eventBus } from '../../src/shared/event-bus.js';
import { seedFixtures } from './fixtures.js';

// Register inventory handlers for this file (idempotent guard)
eventBus.removeAllListeners('salesOrder:confirmed');
eventBus.removeAllListeners('salesOrder:cancelled');
eventBus.removeAllListeners('purchaseOrder:completed');
registerInventoryEventHandlers();

describe('salesOrderService.create', () => {
  it('creates order, items, and receivable with EOMONTH due date', async () => {
    const f = await seedFixtures();

    const order = await salesOrderService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'Test Admin',
      createdBy: f.employeeId,
      items: [{ productName: f.productName, quantity: 2, unitPrice: 17200 }],
    });

    expect(order.orderNo).toMatch(/^\d{11}$/); // YYYYMMDD + 3-digit seq
    expect(order.items).toHaveLength(1);
    expect(Number(order.subtotal)).toBe(34400);
    expect(Number(order.taxAmount)).toBe(1720);
    expect(Number(order.totalAmount)).toBe(36120);
    expect(order.receivable).not.toBeNull();
    expect(Number(order.receivable!.amount)).toBe(36120);
    expect(order.receivable!.isPaid).toBe(false);

    // Due date = end of (billingMonth + floor(30/30)=1) month
    const now = new Date();
    const expectedDueMonth = now.getMonth() + 1; // next month index relative to 0-based
    // Sanity: due date is after today
    expect(order.receivable!.dueDate.getTime()).toBeGreaterThan(Date.now());
    expect(order.receivable!.dueDate.getMonth()).toBe(expectedDueMonth % 12);
  });

  it('emits salesOrder:confirmed → inventory decrements', async () => {
    const f = await seedFixtures();
    // Start with 10 in stock
    await prisma.inventory.create({
      data: { tenantId: f.tenantId, productId: f.productId, quantity: 10 },
    });

    await salesOrderService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'Test Admin',
      createdBy: f.employeeId,
      items: [{ productName: f.productName, quantity: 3, unitPrice: 100 }],
    });

    // event handlers are async — let microtasks drain
    await new Promise((r) => setTimeout(r, 100));

    const inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(7);

    const txns = await prisma.inventoryTransaction.findMany({
      where: { tenantId: f.tenantId, reason: 'SALES_OUT' },
    });
    expect(txns).toHaveLength(1);
    expect(txns[0].delta).toBe(-3);
  });

  it('generates monotonically-increasing orderNo within the same day', async () => {
    const f = await seedFixtures();
    const a = await salesOrderService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'x',
      createdBy: f.employeeId,
      items: [{ productName: 'X', quantity: 1, unitPrice: 100 }],
    });
    const b = await salesOrderService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'x',
      createdBy: f.employeeId,
      items: [{ productName: 'X', quantity: 1, unitPrice: 100 }],
    });
    expect(b.orderNo > a.orderNo).toBe(true);
  });

  it('rejects empty items list', async () => {
    const f = await seedFixtures();
    await expect(
      salesOrderService.create(f.tenantId, {
        customerId: f.customerId,
        salesPerson: 'x',
        createdBy: f.employeeId,
        items: [],
      }),
    ).rejects.toThrow(/at least one item/);
  });
});
