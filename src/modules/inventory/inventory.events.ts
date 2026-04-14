import { prisma } from '../../shared/prisma.js';
import { eventBus } from '../../shared/event-bus.js';
import { logger } from '../../shared/logger.js';
import * as inventoryService from './inventory.service.js';

/**
 * Map SalesOrder items (by productName) to product ids for a tenant.
 * Items with no matching product are skipped with a warning.
 */
async function resolveProducts(
  tenantId: string,
  items: { productName: string; quantity: number }[],
  context: string,
) {
  const resolved: { productId: string; quantity: number; productName: string }[] = [];
  for (const item of items) {
    const product = await prisma.product.findFirst({
      where: { tenantId, name: item.productName },
    });
    if (!product) {
      logger.warn(`Inventory: no product match for "${item.productName}" (${context})`, {
        tenantId,
        productName: item.productName,
      });
      continue;
    }
    resolved.push({
      productId: product.id,
      quantity: item.quantity,
      productName: item.productName,
    });
  }
  return resolved;
}

export function registerInventoryEventHandlers(): void {
  // Sales order confirmed — decrement inventory for each item
  eventBus.on('salesOrder:confirmed', async ({ tenantId, salesOrderId }) => {
    const order = await prisma.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId },
      include: { items: true },
    });
    if (!order) {
      logger.warn(`Inventory: SalesOrder not found on confirm`, { tenantId, salesOrderId });
      return;
    }

    const resolved = await resolveProducts(
      tenantId,
      order.items.map((i) => ({ productName: i.productName, quantity: i.quantity })),
      `salesOrder:confirmed ${salesOrderId}`,
    );

    for (const item of resolved) {
      await inventoryService.adjust(tenantId, item.productId, -item.quantity, 'SALES_OUT', {
        refType: 'SalesOrder',
        refId: salesOrderId,
        note: `Sales order ${order.orderNo}`,
      });
    }
  });

  // Sales order cancelled — reverse prior SALES_OUT transactions if any exist
  eventBus.on('salesOrder:cancelled', async ({ tenantId, salesOrderId }) => {
    const prior = await prisma.inventoryTransaction.findMany({
      where: {
        tenantId,
        refType: 'SalesOrder',
        refId: salesOrderId,
        reason: 'SALES_OUT',
      },
    });

    if (prior.length === 0) {
      // Nothing to reverse — order was never confirmed
      return;
    }

    // Aggregate deltas per product (in case of multiple adjustments)
    const perProduct = new Map<string, number>();
    for (const txn of prior) {
      perProduct.set(txn.productId, (perProduct.get(txn.productId) ?? 0) + txn.delta);
    }

    // Guard: don't double-reverse. Check for existing ADJUSTMENT reversals with same refId.
    const reversals = await prisma.inventoryTransaction.findMany({
      where: {
        tenantId,
        refType: 'SalesOrder',
        refId: salesOrderId,
        reason: 'ADJUSTMENT',
        note: { contains: 'reversal' },
      },
    });
    if (reversals.length > 0) {
      return;
    }

    for (const [productId, totalDelta] of perProduct.entries()) {
      await inventoryService.adjust(tenantId, productId, -totalDelta, 'ADJUSTMENT', {
        refType: 'SalesOrder',
        refId: salesOrderId,
        note: `Sales order cancellation reversal`,
      });
    }
  });

  // Purchase order completed — increment inventory for each item
  eventBus.on('purchaseOrder:completed', async ({ tenantId, purchaseOrderId }) => {
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, tenantId },
      include: { items: true },
    });
    if (!order) {
      logger.warn(`Inventory: PurchaseOrder not found on complete`, {
        tenantId,
        purchaseOrderId,
      });
      return;
    }

    const resolved = await resolveProducts(
      tenantId,
      order.items.map((i) => ({ productName: i.productName, quantity: i.quantity })),
      `purchaseOrder:completed ${purchaseOrderId}`,
    );

    for (const item of resolved) {
      await inventoryService.adjust(tenantId, item.productId, item.quantity, 'PURCHASE_IN', {
        refType: 'PurchaseOrder',
        refId: purchaseOrderId,
        note: `Purchase order ${order.orderNo}`,
      });
    }
  });

  logger.info('Inventory event handlers registered');
}
