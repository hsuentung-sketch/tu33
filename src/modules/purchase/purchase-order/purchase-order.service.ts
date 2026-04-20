import type { Prisma, PurchaseStatus } from '@prisma/client';
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

export interface PurchaseItemInput {
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  referenceCost?: number;
  lastPurchaseDate?: Date;
  sortOrder?: number;
}

export interface PurchaseOrderCreateInput {
  supplierId: string;
  internalStaff: string;
  staffPhone?: string;
  deliveryNote?: string;
  createdBy: string;
  items: PurchaseItemInput[];
}

export async function list(
  tenantId: string,
  filters: { status?: PurchaseStatus; supplierId?: string; includeDeleted?: boolean } = {},
) {
  return prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      ...(filters.includeDeleted ? {} : { isDeleted: false }),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    },
    include: { items: true, supplier: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId },
    include: { items: true, supplier: true, payable: true },
  });
  if (!order) throw new NotFoundError('PurchaseOrder', id);
  return order;
}

export async function create(tenantId: string, data: PurchaseOrderCreateInput) {
  if (!data.items?.length) {
    throw new ValidationError('Purchase order must include at least one item');
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, tenantId },
  });
  if (!supplier) throw new NotFoundError('Supplier', data.supplierId);

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
  const dueDate = calculateDueDate(billingYear, billingMonth, supplier.paymentDays);

  const created = await createWithDailyNumber({
    counter: (tx, w) =>
      tx.purchaseOrder.count({
        where: { tenantId, createdAt: { gte: w.start, lt: w.end } },
      }),
    createFn: (tx, orderNo) => tx.purchaseOrder.create({
      data: {
        tenantId,
        orderNo,
        supplierId: data.supplierId,
        internalStaff: data.internalStaff,
        staffPhone: data.staffPhone,
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
            referenceCost: i.referenceCost,
            lastPurchaseDate: i.lastPurchaseDate,
            sortOrder: i.sortOrder ?? idx,
          })),
        },
        payable: {
          create: {
            tenantId,
            supplierId: data.supplierId,
            billingYear,
            billingMonth,
            amount: totalAmount,
            dueDate,
          },
        },
      },
      include: { items: true, payable: true },
    }),
  });

  await eventBus.emitAsync('purchaseOrder:created', {
    tenantId,
    purchaseOrderId: created.id,
    supplierId: created.supplierId,
  });
  // LINE flow records receipts after-the-fact — treat creation as completed to trigger stock-in.
  await eventBus.emitAsync('purchaseOrder:completed', { tenantId, purchaseOrderId: created.id });

  return created;
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.PurchaseOrderUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.purchaseOrder.update({ where: { id }, data, include: { items: true } });
}

export async function markReceived(tenantId: string, id: string) {
  const order = await getById(tenantId, id);
  if (order.status !== 'PENDING') {
    throw new ValidationError(`Cannot receive order in status ${order.status}`);
  }
  return prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'RECEIVED', receivedDate: new Date() },
  });
}

/**
 * Full edit — replaces header + item list, recomputes totals, syncs AP.
 */
export interface PurchaseOrderEditInput {
  supplierId?: string;
  internalStaff?: string;
  staffPhone?: string | null;
  deliveryNote?: string | null;
  items: PurchaseItemInput[];
  reason?: string;
  editedBy: string;
}

export async function edit(tenantId: string, id: string, input: PurchaseOrderEditInput) {
  const existing = await getById(tenantId, id);
  if (existing.isDeleted) throw new ValidationError('此進貨單已刪除');
  if (existing.payable?.isPaid) {
    throw new ValidationError('對應應付帳款已付款，無法修改');
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

  const oldItems = existing.items.map((it) => ({
    productName: it.productName,
    quantity: it.quantity,
  }));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: id } });
    const row = await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        ...(input.internalStaff !== undefined ? { internalStaff: input.internalStaff } : {}),
        ...(input.staffPhone !== undefined ? { staffPhone: input.staffPhone } : {}),
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
            referenceCost: i.referenceCost,
            lastPurchaseDate: i.lastPurchaseDate,
            sortOrder: i.sortOrder ?? idx,
          })),
        },
      },
      include: { items: true, supplier: true, payable: true },
    });
    if (existing.payable) {
      await tx.accountPayable.update({
        where: { id: existing.payable.id },
        data: { amount: totalAmount },
      });
    }
    return row;
  });

  await reverseInventory(tenantId, id, oldItems, 'PURCHASE_IN', input.editedBy);
  await eventBus.emitAsync('purchaseOrder:completed', { tenantId, purchaseOrderId: id });

  return updated;
}

export async function softDelete(
  tenantId: string, id: string, deletedBy: string, _reason?: string,
) {
  const existing = await getById(tenantId, id);
  if (existing.isDeleted) throw new ValidationError('此進貨單已刪除');
  if (existing.payable?.isPaid) {
    throw new ValidationError('對應應付帳款已付款，無法刪除');
  }
  const oldItems = existing.items.map((it) => ({
    productName: it.productName,
    quantity: it.quantity,
  }));

  await prisma.$transaction(async (tx) => {
    if (existing.payable) {
      await tx.accountPayable.delete({ where: { id: existing.payable.id } });
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedBy },
    });
  });
  await reverseInventory(tenantId, id, oldItems, 'PURCHASE_IN', deletedBy);
  return { ok: true };
}

async function reverseInventory(
  tenantId: string,
  refId: string,
  items: { productName: string; quantity: number }[],
  reason: 'SALES_OUT' | 'PURCHASE_IN',
  createdBy: string,
) {
  for (const it of items) {
    const p = await prisma.product.findFirst({
      where: { tenantId, name: it.productName },
      select: { id: true },
    });
    if (!p) continue;
    const delta = reason === 'PURCHASE_IN' ? -it.quantity : it.quantity;
    try {
      await prisma.$transaction([
        prisma.inventoryTransaction.create({
          data: {
            tenantId,
            productId: p.id,
            delta,
            reason,
            refType: 'PurchaseOrder:edit',
            refId,
            note: '編輯/刪除連動沖銷',
            createdBy,
          },
        }),
        prisma.inventory.upsert({
          where: { tenantId_productId: { tenantId, productId: p.id } },
          create: { tenantId, productId: p.id, quantity: delta },
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
  if (order.status !== 'RECEIVED') {
    throw new ValidationError(`Cannot complete order in status ${order.status}`);
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'COMPLETED' },
  });
  eventBus.emit('purchaseOrder:completed', { tenantId, purchaseOrderId: id });
  return updated;
}
