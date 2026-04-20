import type { Prisma, SalesStatus } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { eventBus } from '../../../shared/event-bus.js';
import {
  calculateDueDate,
  calculateTotals,
  getTenantSettings,
} from '../../../shared/utils.js';
import { createWithDailyNumber } from '../../../shared/document-no.js';
import { taipeiNow } from '../../../shared/timezone.js';

export interface SalesItemInput {
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  sortOrder?: number;
}

export interface SalesOrderCreateInput {
  customerId: string;
  salesPerson: string;
  salesPhone?: string;
  deliveryNote?: string;
  createdBy: string;
  items: SalesItemInput[];
}

export async function list(
  tenantId: string,
  filters: { status?: SalesStatus; customerId?: string; includeDeleted?: boolean } = {},
) {
  return prisma.salesOrder.findMany({
    where: {
      tenantId,
      ...(filters.includeDeleted ? {} : { isDeleted: false }),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    include: { items: true, customer: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const order = await prisma.salesOrder.findFirst({
    where: { id, tenantId },
    include: { items: true, customer: true, receivable: true, quotation: true },
  });
  if (!order) throw new NotFoundError('SalesOrder', id);
  return order;
}

export async function create(tenantId: string, data: SalesOrderCreateInput) {
  if (!data.items?.length) {
    throw new ValidationError('Sales order must include at least one item');
  }

  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, tenantId },
  });
  if (!customer) throw new NotFoundError('Customer', data.customerId);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);

  const { subtotal, taxAmount, totalAmount } = calculateTotals(
    data.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
    settings.taxRate,
  );

  const tp = taipeiNow();
  const billingYear = tp.year;
  const billingMonth = tp.month;
  const dueDate = calculateDueDate(billingYear, billingMonth, customer.paymentDays);

  const created = await createWithDailyNumber({
    counter: (tx, w) =>
      tx.salesOrder.count({
        where: { tenantId, createdAt: { gte: w.start, lt: w.end } },
      }),
    createFn: (tx, orderNo) => tx.salesOrder.create({
      data: {
        tenantId,
        orderNo,
        customerId: data.customerId,
        salesPerson: data.salesPerson,
        salesPhone: data.salesPhone,
        deliveryNote: data.deliveryNote,
        subtotal,
        taxAmount,
        totalAmount,
        createdBy: data.createdBy,
        items: {
          create: data.items.map((i, idx) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.quantity * i.unitPrice,
            note: i.note,
            sortOrder: i.sortOrder ?? idx,
          })),
        },
        receivable: {
          create: {
            tenantId,
            customerId: data.customerId,
            billingYear,
            billingMonth,
            amount: totalAmount,
            dueDate,
          },
        },
      },
      include: { items: true, receivable: true },
    }),
  });

  await eventBus.emitAsync('salesOrder:created', { tenantId, salesOrderId: created.id });
  // LINE flow treats creation as user-confirmed — trigger inventory decrement.
  await eventBus.emitAsync('salesOrder:confirmed', { tenantId, salesOrderId: created.id });

  return created;
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.SalesOrderUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.salesOrder.update({ where: { id }, data, include: { items: true } });
}

export async function markDelivered(
  tenantId: string,
  id: string,
  info: { deliveredBy: string; receivedBy?: string },
) {
  const order = await getById(tenantId, id);
  if (order.status !== 'PENDING') {
    throw new ValidationError(`Cannot deliver order in status ${order.status}`);
  }
  const updated = await prisma.salesOrder.update({
    where: { id },
    data: {
      status: 'DELIVERED',
      deliveryDate: new Date(),
      deliveredBy: info.deliveredBy,
      receivedBy: info.receivedBy,
    },
  });
  eventBus.emit('salesOrder:shipped', { tenantId, salesOrderId: id, shipmentId: id });
  return updated;
}

/**
 * Full edit — replaces header + item list, recomputes totals, and
 * synchronises the linked AccountReceivable amount. Blocked if the
 * receivable is already paid.
 *
 * Status rules (C2):
 *   - PENDING        → freely editable
 *   - DELIVERED/COMPLETED → `reason` required, logged via AuditLog
 */
export interface SalesOrderEditInput {
  customerId?: string;
  salesPerson?: string;
  salesPhone?: string | null;
  deliveryNote?: string | null;
  items: SalesItemInput[];
  reason?: string;
  editedBy: string;
}

export async function edit(tenantId: string, id: string, input: SalesOrderEditInput) {
  const existing = await getById(tenantId, id);
  if (existing.isDeleted) throw new ValidationError('此銷貨單已刪除');
  if (existing.receivable?.isPaid) {
    throw new ValidationError('對應應收帳款已入帳，無法修改');
  }
  if (existing.status !== 'PENDING') {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError(`狀態 ${existing.status} 下修改需填寫修改原因`);
    }
  }
  if (!input.items?.length) throw new ValidationError('至少需要一個品項');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);

  const { subtotal, taxAmount, totalAmount } = calculateTotals(
    input.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
    settings.taxRate,
  );

  // Snapshot old item list so inventory can be reconciled outside the tx.
  const oldItems = existing.items.map((it) => ({
    productName: it.productName,
    quantity: it.quantity,
  }));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.salesItem.deleteMany({ where: { salesOrderId: id } });
    const row = await tx.salesOrder.update({
      where: { id },
      data: {
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.salesPerson !== undefined ? { salesPerson: input.salesPerson } : {}),
        ...(input.salesPhone !== undefined ? { salesPhone: input.salesPhone } : {}),
        ...(input.deliveryNote !== undefined ? { deliveryNote: input.deliveryNote } : {}),
        subtotal,
        taxAmount,
        totalAmount,
        items: {
          create: input.items.map((i, idx) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.quantity * i.unitPrice,
            note: i.note,
            sortOrder: i.sortOrder ?? idx,
          })),
        },
      },
      include: { items: true, customer: true, receivable: true },
    });
    if (existing.receivable) {
      await tx.accountReceivable.update({
        where: { id: existing.receivable.id },
        data: { amount: totalAmount },
      });
    }
    return row;
  });

  // Inventory reconciliation: reverse each old item (sales out returned),
  // then re-emit the confirmed event so new lines are decremented.
  await reverseInventory(tenantId, id, oldItems, 'SALES_OUT', input.editedBy);
  await eventBus.emitAsync('salesOrder:confirmed', { tenantId, salesOrderId: id });

  return updated;
}

/**
 * Soft-delete a sales order. Hard-deletes the AR (依附於銷貨單) and
 * writes a reversing inventory transaction.
 */
export async function softDelete(
  tenantId: string, id: string, deletedBy: string, _reason?: string,
) {
  const existing = await getById(tenantId, id);
  if (existing.isDeleted) throw new ValidationError('此銷貨單已刪除');
  if (existing.receivable?.isPaid) {
    throw new ValidationError('對應應收帳款已入帳，無法刪除');
  }
  const oldItems = existing.items.map((it) => ({
    productName: it.productName,
    quantity: it.quantity,
  }));

  await prisma.$transaction(async (tx) => {
    if (existing.receivable) {
      await tx.accountReceivable.delete({ where: { id: existing.receivable.id } });
    }
    await tx.salesOrder.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedBy },
    });
  });
  await reverseInventory(tenantId, id, oldItems, 'SALES_OUT', deletedBy);
  return { ok: true };
}

/**
 * Write a reversing InventoryTransaction for each line. Looks up product
 * by exact name match (銷貨/進貨品項保留品名而非 id)。找不到就略過那一行。
 */
async function reverseInventory(
  tenantId: string,
  refId: string,
  items: { productName: string; quantity: number }[],
  reason: 'SALES_OUT' | 'PURCHASE_IN',
  createdBy: string,
) {
  if (!items.length) return;
  // Batch product lookup: 1 query instead of N.
  const names = Array.from(new Set(items.map((i) => i.productName)));
  const products = await prisma.product.findMany({
    where: { tenantId, name: { in: names } },
    select: { id: true, name: true },
  });
  const byName = new Map(products.map((p) => [p.name, p.id]));

  for (const it of items) {
    const productId = byName.get(it.productName);
    if (!productId) continue;
    // Reversal: if original was SALES_OUT (負數)，反向寫正數；PURCHASE_IN 反之。
    const delta = reason === 'SALES_OUT' ? it.quantity : -it.quantity;
    try {
      await prisma.$transaction([
        prisma.inventoryTransaction.create({
          data: {
            tenantId,
            productId,
            delta,
            reason,
            refType: reason === 'SALES_OUT' ? 'SalesOrder:edit' : 'PurchaseOrder:edit',
            refId,
            note: '編輯/刪除連動沖銷',
            createdBy,
          },
        }),
        prisma.inventory.upsert({
          where: { tenantId_productId: { tenantId, productId } },
          create: { tenantId, productId, quantity: delta },
          update: { quantity: { increment: delta } },
        }),
      ]);
    } catch {
      // non-fatal
    }
  }
}

export async function complete(tenantId: string, id: string) {
  const order = await getById(tenantId, id);
  if (order.status !== 'DELIVERED') {
    throw new ValidationError(`Cannot complete order in status ${order.status}`);
  }
  const updated = await prisma.salesOrder.update({
    where: { id },
    data: { status: 'COMPLETED' },
  });
  eventBus.emit('salesOrder:completed', { tenantId, salesOrderId: id });
  return updated;
}
