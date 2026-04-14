import type { Prisma, PurchaseStatus } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { eventBus } from '../../../shared/event-bus.js';
import {
  generateDocumentNo,
  calculateDueDate,
  calculateTotals,
  getTenantSettings,
} from '../../../shared/utils.js';

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
  filters: { status?: PurchaseStatus; supplierId?: string } = {},
) {
  return prisma.purchaseOrder.findMany({
    where: {
      tenantId,
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

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayCount = await tx.purchaseOrder.count({
      where: { tenantId, createdAt: { gte: startOfDay, lt: endOfDay } },
    });
    const orderNo = generateDocumentNo(now, todayCount + 1);

    const billingYear = now.getFullYear();
    const billingMonth = now.getMonth() + 1;
    const dueDate = calculateDueDate(billingYear, billingMonth, supplier.paymentDays);

    const created = await tx.purchaseOrder.create({
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
    });

    eventBus.emit('purchaseOrder:created', {
      tenantId,
      purchaseOrderId: created.id,
      supplierId: created.supplierId,
    });
    // LINE flow records receipts after-the-fact — treat creation as completed to trigger stock-in.
    eventBus.emit('purchaseOrder:completed', { tenantId, purchaseOrderId: created.id });

    return created;
  });
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
