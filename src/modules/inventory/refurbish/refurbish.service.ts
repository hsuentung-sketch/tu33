import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { adjust } from '../inventory.service.js';

export async function list(tenantId: string, opts: { status?: string } = {}) {
  return prisma.refurbishOrder.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: {
      usedMachine: { select: { id: true, code: true, name: true, purchaseCost: true, refurbishCost: true, salePrice: true } },
      items: { include: { product: { select: { id: true, code: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.refurbishOrder.findFirst({
    where: { id, tenantId },
    include: {
      usedMachine: { select: { id: true, code: true, name: true, purchaseCost: true, refurbishCost: true, salePrice: true } },
      items: { include: { product: { select: { id: true, code: true, name: true } } } },
    },
  });
  if (!row) throw new NotFoundError('RefurbishOrder', id);
  return row;
}

export async function create(
  tenantId: string,
  data: { usedMachineId: string; note?: string; createdBy: string },
) {
  const machine = await prisma.product.findFirst({
    where: { id: data.usedMachineId, tenantId },
  });
  if (!machine) throw new NotFoundError('Product', data.usedMachineId);

  return prisma.refurbishOrder.create({
    data: {
      tenantId,
      usedMachineId: data.usedMachineId,
      note: data.note,
      createdBy: data.createdBy,
    },
    include: {
      usedMachine: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function addItem(
  tenantId: string,
  orderId: string,
  data: { productId: string; quantity: number; unitCost: number; createdBy?: string },
) {
  const order = await prisma.refurbishOrder.findFirst({
    where: { id: orderId, tenantId },
  });
  if (!order) throw new NotFoundError('RefurbishOrder', orderId);
  if (order.status !== 'IN_PROGRESS') {
    throw new ValidationError('只能在進行中的整備工單加零件');
  }

  const part = await prisma.product.findFirst({
    where: { id: data.productId, tenantId },
  });
  if (!part) throw new NotFoundError('Product', data.productId);

  const item = await prisma.refurbishOrderItem.create({
    data: {
      refurbishOrderId: orderId,
      productId: data.productId,
      quantity: data.quantity,
      unitCost: data.unitCost,
    },
    include: { product: { select: { id: true, code: true, name: true } } },
  });

  await adjust(tenantId, data.productId, -data.quantity, 'REFURBISH_OUT', {
    refType: 'RefurbishOrder',
    refId: orderId,
    note: `整備用料：${part.name} x${data.quantity}`,
    createdBy: data.createdBy,
  });

  return item;
}

export async function removeItem(
  tenantId: string,
  orderId: string,
  itemId: string,
  createdBy?: string,
) {
  const order = await prisma.refurbishOrder.findFirst({
    where: { id: orderId, tenantId },
  });
  if (!order) throw new NotFoundError('RefurbishOrder', orderId);
  if (order.status !== 'IN_PROGRESS') {
    throw new ValidationError('只能在進行中的整備工單刪除零件');
  }

  const item = await prisma.refurbishOrderItem.findFirst({
    where: { id: itemId, refurbishOrderId: orderId },
    include: { product: { select: { id: true, name: true } } },
  });
  if (!item) throw new NotFoundError('RefurbishOrderItem', itemId);

  await prisma.refurbishOrderItem.delete({ where: { id: itemId } });

  await adjust(tenantId, item.productId, item.quantity, 'ADJUSTMENT', {
    refType: 'RefurbishOrder',
    refId: orderId,
    note: `整備退料：${item.product.name} x${item.quantity}`,
    createdBy,
  });

  return { deleted: true };
}

export async function complete(tenantId: string, orderId: string) {
  const order = await prisma.refurbishOrder.findFirst({
    where: { id: orderId, tenantId },
    include: { items: true },
  });
  if (!order) throw new NotFoundError('RefurbishOrder', orderId);
  if (order.status !== 'IN_PROGRESS') {
    throw new ValidationError('工單不在進行中狀態');
  }

  const totalCost = order.items.reduce(
    (sum, it) => sum + it.quantity * Number(it.unitCost),
    0,
  );

  const [updated] = await prisma.$transaction([
    prisma.refurbishOrder.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', totalCost },
    }),
    prisma.product.update({
      where: { id: order.usedMachineId },
      data: { refurbishCost: totalCost },
    }),
  ]);

  return updated;
}

export async function cancel(tenantId: string, orderId: string) {
  const order = await prisma.refurbishOrder.findFirst({
    where: { id: orderId, tenantId },
  });
  if (!order) throw new NotFoundError('RefurbishOrder', orderId);
  if (order.status !== 'IN_PROGRESS') {
    throw new ValidationError('只能取消進行中的工單');
  }

  return prisma.refurbishOrder.update({
    where: { id: orderId },
    data: { status: 'CANCELLED' },
  });
}
