import type { Prisma, QuotationStatus } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { eventBus } from '../../../shared/event-bus.js';
import {
  generateDocumentNo,
  calculateDueDate,
  calculateTotals,
  getTenantSettings,
} from '../../../shared/utils.js';

export interface QuotationItemInput {
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  suggestedPrice?: number;
  sortOrder?: number;
}

export interface QuotationCreateInput {
  customerId: string;
  salesPerson: string;
  salesPhone?: string;
  supplyTime?: string;
  paymentTerms?: string;
  validUntil?: string;
  note?: string;
  createdBy: string;
  items: QuotationItemInput[];
}

export async function list(
  tenantId: string,
  filters: { status?: QuotationStatus; customerId?: string } = {},
) {
  return prisma.quotation.findMany({
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
  const quotation = await prisma.quotation.findFirst({
    where: { id, tenantId },
    include: { items: true, customer: true, salesOrder: true },
  });
  if (!quotation) {
    throw new NotFoundError('Quotation', id);
  }
  return quotation;
}

export async function create(tenantId: string, data: QuotationCreateInput) {
  if (!data.items?.length) {
    throw new ValidationError('Quotation must include at least one item');
  }

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
    const todayCount = await tx.quotation.count({
      where: { tenantId, createdAt: { gte: startOfDay, lt: endOfDay } },
    });
    const quotationNo = generateDocumentNo(now, todayCount + 1);

    const created = await tx.quotation.create({
      data: {
        tenantId,
        quotationNo,
        customerId: data.customerId,
        salesPerson: data.salesPerson,
        salesPhone: data.salesPhone,
        subtotal,
        taxAmount,
        totalAmount,
        supplyTime: data.supplyTime,
        paymentTerms: data.paymentTerms,
        validUntil: data.validUntil,
        note: data.note,
        createdBy: data.createdBy,
        items: {
          create: data.items.map((i, idx) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.quantity * i.unitPrice,
            note: i.note,
            suggestedPrice: i.suggestedPrice,
            sortOrder: i.sortOrder ?? idx,
          })),
        },
      },
      include: { items: true },
    });

    eventBus.emit('quotation:created', {
      tenantId,
      quotationId: created.id,
      customerId: created.customerId,
    });

    return created;
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.QuotationUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.quotation.update({ where: { id }, data, include: { items: true } });
}

const VALID_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['TRACKING', 'WON', 'LOST', 'CANCELLED'],
  TRACKING: ['WON', 'LOST', 'CANCELLED'],
  WON: [],
  LOST: [],
  CANCELLED: [],
};

export async function updateStatus(
  tenantId: string,
  id: string,
  nextStatus: QuotationStatus,
  extra: { trackingNote?: string; reason?: string } = {},
) {
  const existing = await getById(tenantId, id);
  const allowed = VALID_TRANSITIONS[existing.status];
  if (!allowed.includes(nextStatus)) {
    throw new ValidationError(
      `Invalid status transition: ${existing.status} -> ${nextStatus}`,
    );
  }

  const updated = await prisma.quotation.update({
    where: { id },
    data: {
      status: nextStatus,
      ...(extra.trackingNote ? { trackingNote: extra.trackingNote } : {}),
      ...(nextStatus === 'WON' || nextStatus === 'LOST'
        ? { dealClosed: nextStatus === 'WON' }
        : {}),
    },
  });

  if (nextStatus === 'LOST') {
    eventBus.emit('quotation:lost', { tenantId, quotationId: id, reason: extra.reason });
  }

  return updated;
}

export async function convertToSalesOrder(
  tenantId: string,
  id: string,
  createdBy: string,
) {
  const quotation = await getById(tenantId, id);
  if (quotation.status === 'CANCELLED' || quotation.status === 'LOST') {
    throw new ValidationError(`Cannot convert quotation in status ${quotation.status}`);
  }
  if (quotation.salesOrder) {
    throw new ValidationError('Quotation already converted to sales order');
  }

  const customer = await prisma.customer.findFirst({
    where: { id: quotation.customerId, tenantId },
  });
  if (!customer) throw new NotFoundError('Customer', quotation.customerId);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);

  return prisma.$transaction(async (tx) => {
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

    const salesOrder = await tx.salesOrder.create({
      data: {
        tenantId,
        orderNo,
        customerId: quotation.customerId,
        quotationId: quotation.id,
        salesPerson: quotation.salesPerson,
        salesPhone: quotation.salesPhone,
        subtotal: quotation.subtotal,
        taxAmount: quotation.taxAmount,
        totalAmount: quotation.totalAmount,
        createdBy,
        items: {
          create: quotation.items.map((i, idx) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
            note: i.note,
            sortOrder: i.sortOrder ?? idx,
          })),
        },
        receivable: {
          create: {
            tenantId,
            customerId: quotation.customerId,
            billingYear,
            billingMonth,
            amount: quotation.totalAmount,
            dueDate,
          },
        },
      },
      include: { items: true, receivable: true },
    });

    void settings;

    eventBus.emit('quotation:won', {
      tenantId,
      quotationId: quotation.id,
      salesOrderId: salesOrder.id,
    });
    eventBus.emit('salesOrder:created', {
      tenantId,
      salesOrderId: salesOrder.id,
      quotationId: quotation.id,
    });
    // Conversion is user-confirmed → trigger inventory decrement.
    eventBus.emit('salesOrder:confirmed', { tenantId, salesOrderId: salesOrder.id });

    // Flip quotation to WON so it's marked closed.
    await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: 'WON', dealClosed: true },
    });

    return salesOrder;
  });
}
