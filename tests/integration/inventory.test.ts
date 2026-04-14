import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/shared/prisma.js';
import * as inventoryService from '../../src/modules/inventory/inventory.service.js';
import * as salesOrderService from '../../src/modules/sales/sales-order/sales-order.service.js';
import * as purchaseOrderService from '../../src/modules/purchase/purchase-order/purchase-order.service.js';
import { registerInventoryEventHandlers } from '../../src/modules/inventory/inventory.events.js';
import { eventBus } from '../../src/shared/event-bus.js';
import { seedFixtures } from './fixtures.js';

// Register event handlers once for this file
eventBus.removeAllListeners('salesOrder:confirmed');
eventBus.removeAllListeners('salesOrder:cancelled');
eventBus.removeAllListeners('purchaseOrder:completed');
registerInventoryEventHandlers();

describe('inventoryService.adjust', () => {
  it('creates inventory row on first adjust', async () => {
    const f = await seedFixtures();
    await inventoryService.adjust(f.tenantId, f.productId, 100, 'INITIAL');
    const inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(100);
  });

  it('appends a ledger entry with reason and refs', async () => {
    const f = await seedFixtures();
    await inventoryService.adjust(f.tenantId, f.productId, 5, 'PURCHASE_IN', {
      refType: 'PurchaseOrder',
      refId: 'PO-1',
      note: 'test',
    });
    const txns = await prisma.inventoryTransaction.findMany({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(txns).toHaveLength(1);
    expect(txns[0].reason).toBe('PURCHASE_IN');
    expect(txns[0].delta).toBe(5);
    expect(txns[0].refType).toBe('PurchaseOrder');
    expect(txns[0].refId).toBe('PO-1');
  });

  it('accumulates multiple adjustments', async () => {
    const f = await seedFixtures();
    await inventoryService.adjust(f.tenantId, f.productId, 10, 'INITIAL');
    await inventoryService.adjust(f.tenantId, f.productId, 5, 'PURCHASE_IN');
    await inventoryService.adjust(f.tenantId, f.productId, -3, 'SALES_OUT');
    const inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(12);
  });
});

describe('purchase order → inventory increment via event', () => {
  it('stock increases after purchase order creation', async () => {
    const f = await seedFixtures();
    await purchaseOrderService.create(f.tenantId, {
      supplierId: f.supplierId,
      internalStaff: 'x',
      createdBy: f.employeeId,
      items: [{ productName: f.productName, quantity: 20, unitPrice: 1000 }],
    });
    await new Promise((r) => setTimeout(r, 150));

    const inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(20);
  });
});

describe('sales order cancel → inventory reversal (idempotent)', () => {
  it('manual emit of salesOrder:cancelled restores stock once', async () => {
    const f = await seedFixtures();
    await prisma.inventory.create({
      data: { tenantId: f.tenantId, productId: f.productId, quantity: 10 },
    });
    const order = await salesOrderService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'x',
      createdBy: f.employeeId,
      items: [{ productName: f.productName, quantity: 3, unitPrice: 100 }],
    });
    await new Promise((r) => setTimeout(r, 150));
    let inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(7);

    // Cancel
    eventBus.emit('salesOrder:cancelled', {
      tenantId: f.tenantId,
      salesOrderId: order.id,
      reason: 'test',
    });
    await new Promise((r) => setTimeout(r, 200));
    inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(10);

    // Cancel again — should be no-op (idempotent)
    eventBus.emit('salesOrder:cancelled', {
      tenantId: f.tenantId,
      salesOrderId: order.id,
      reason: 'test',
    });
    await new Promise((r) => setTimeout(r, 200));
    inv = await prisma.inventory.findFirst({
      where: { tenantId: f.tenantId, productId: f.productId },
    });
    expect(inv?.quantity).toBe(10);
  });
});
