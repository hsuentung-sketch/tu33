import type { InventoryReason, Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma.js';
import { NotFoundError } from '../../shared/errors.js';
import { eventBus } from '../../shared/event-bus.js';

export interface AdjustOptions {
  refType?: string;
  refId?: string;
  note?: string;
  createdBy?: string;
}

export async function getInventory(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) throw new NotFoundError('Product', productId);

  const existing = await prisma.inventory.findUnique({
    where: { tenantId_productId: { tenantId, productId } },
  });
  if (existing) return existing;

  return prisma.inventory.create({
    data: { tenantId, productId, quantity: 0, reorderPoint: 0 },
  });
}

export async function adjust(
  tenantId: string,
  productId: string,
  delta: number,
  reason: InventoryReason,
  opts: AdjustOptions = {},
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) throw new NotFoundError('Product', productId);

  const result = await prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.upsert({
      where: { tenantId_productId: { tenantId, productId } },
      create: {
        tenantId,
        productId,
        quantity: delta,
        reorderPoint: 0,
      },
      update: {
        quantity: { increment: delta },
      },
    });

    await tx.inventoryTransaction.create({
      data: {
        tenantId,
        productId,
        delta,
        reason,
        refType: opts.refType,
        refId: opts.refId,
        note: opts.note,
        createdBy: opts.createdBy,
      },
    });

    return inventory;
  });

  eventBus.emit('inventory:adjusted', {
    tenantId,
    productId,
    delta,
    reason,
    quantity: result.quantity,
    refType: opts.refType,
    refId: opts.refId,
  });

  if (result.reorderPoint > 0 && result.quantity <= result.reorderPoint) {
    eventBus.emit('inventory:lowStock', {
      tenantId,
      productId,
      currentQty: result.quantity,
      reorderPoint: result.reorderPoint,
    });
  }

  return result;
}

export async function list(
  tenantId: string,
  opts: { lowStockOnly?: boolean } = {},
) {
  const rows = await prisma.inventory.findMany({
    where: { tenantId },
    include: { product: true },
    orderBy: { product: { code: 'asc' } },
  });

  const filtered = opts.lowStockOnly
    ? rows.filter((r) => r.reorderPoint > 0 && r.quantity <= r.reorderPoint)
    : rows;

  return filtered.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    productId: r.productId,
    productCode: r.product.code,
    productName: r.product.name,
    quantity: r.quantity,
    reorderPoint: r.reorderPoint,
    updatedAt: r.updatedAt,
  }));
}

export async function listTransactions(
  tenantId: string,
  productId?: string,
  limit = 50,
) {
  const where: Prisma.InventoryTransactionWhereInput = { tenantId };
  if (productId) where.productId = productId;
  return prisma.inventoryTransaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { product: { select: { code: true, name: true } } },
  });
}

export async function setReorderPoint(
  tenantId: string,
  productId: string,
  value: number,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) throw new NotFoundError('Product', productId);

  return prisma.inventory.upsert({
    where: { tenantId_productId: { tenantId, productId } },
    create: { tenantId, productId, quantity: 0, reorderPoint: value },
    update: { reorderPoint: value },
  });
}
