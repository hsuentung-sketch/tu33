import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.product.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { code: 'asc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const product = await prisma.product.findFirst({
    where: { id, tenantId },
  });
  if (!product) {
    throw new NotFoundError('Product', id);
  }
  return product;
}

export async function create(
  tenantId: string,
  data: {
    code: string;
    name: string;
    category?: string;
    salePrice: number;
    costPrice: number;
    note?: string;
  },
) {
  return prisma.product.create({
    data: {
      tenantId,
      code: data.code,
      name: data.name,
      category: data.category,
      salePrice: data.salePrice,
      costPrice: data.costPrice,
      note: data.note,
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.ProductUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.product.update({
    where: { id },
    data,
  });
}

export async function deactivate(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.product.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function findByNameOrCode(tenantId: string, query: string) {
  return prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 20,
  });
}
