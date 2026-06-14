import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { productId?: string; warrantyStatus?: 'active' | 'expiring' | 'expired' } = {},
) {
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const warrantyFilter =
    opts.warrantyStatus === 'active' ? { warrantyEndAt: { gt: thirtyDaysLater } } :
    opts.warrantyStatus === 'expiring' ? { warrantyEndAt: { gt: now, lte: thirtyDaysLater } } :
    opts.warrantyStatus === 'expired' ? { warrantyEndAt: { lte: now } } :
    {};

  return prisma.machineRecord.findMany({
    where: {
      tenantId,
      ...(opts.productId ? { productId: opts.productId } : {}),
      ...warrantyFilter,
    },
    include: {
      product: { select: { id: true, code: true, name: true, category: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.machineRecord.findFirst({
    where: { id, tenantId },
    include: {
      product: { select: { id: true, code: true, name: true, category: true } },
    },
  });
  if (!row) throw new NotFoundError('MachineRecord', id);
  return row;
}

export async function getBySerial(tenantId: string, serialNumber: string) {
  return prisma.machineRecord.findUnique({
    where: { tenantId_serialNumber: { tenantId, serialNumber } },
    include: {
      product: { select: { id: true, code: true, name: true, category: true } },
    },
  });
}

export async function create(
  tenantId: string,
  data: {
    productId: string;
    serialNumber: string;
    warrantyStartAt: Date;
    warrantyEndAt: Date;
    registeredBy: string;
    salesOrderId?: string;
  },
) {
  const product = await prisma.product.findFirst({
    where: { id: data.productId, tenantId },
  });
  if (!product) throw new NotFoundError('Product', data.productId);

  return prisma.machineRecord.create({
    data: {
      tenantId,
      productId: data.productId,
      serialNumber: data.serialNumber,
      warrantyStartAt: data.warrantyStartAt,
      warrantyEndAt: data.warrantyEndAt,
      registeredBy: data.registeredBy,
      salesOrderId: data.salesOrderId,
    },
    include: {
      product: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: {
    serialNumber?: string;
    warrantyStartAt?: Date;
    warrantyEndAt?: Date;
    salesOrderId?: string | null;
  },
) {
  const existing = await prisma.machineRecord.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('MachineRecord', id);

  return prisma.machineRecord.update({
    where: { id },
    data,
  });
}
