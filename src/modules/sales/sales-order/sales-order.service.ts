import type { Prisma, SalesStatus } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { eventBus } from '../../../shared/event-bus.js';
import {
  generateDocumentNo,
  calculateDueDate,
  calculateTotals,
  getTenantSettings,
} from '../../../shared/utils.js';

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
  filters: { status?: SalesStatus; customerId?: string } = {},
) {
  return prisma.salesOrder.findMany({
    where: {
      tenantId,
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

  const created = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayCount = await tx.salesOrder.count({
      where: { tenantId, createdAt: { gte: startOfDay, lt: endOfDay } },
    });
    const orderNo = generateDocumentNo(now, todayCount + 1);

    const billingYear = now.getFullYear();
    const billingMonth = now.getMonth() + 1;
    const dueDate = calculateDueDate(billingYear, billingMonth, customer.paymentDays);

    const row = await tx.salesOrder.create({
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
    });

    return row;
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
