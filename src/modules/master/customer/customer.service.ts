import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean; createdBy?: string } = {},
) {
  return prisma.customer.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
    },
    orderBy: { name: 'asc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId },
  });
  if (!customer) {
    throw new NotFoundError('Customer', id);
  }
  return customer;
}

export async function create(
  tenantId: string,
  data: {
    name: string;
    contactName?: string;
    taxId?: string;
    phone?: string;
    zipCode?: string;
    address?: string;
    paymentDays?: number;
    lineUserId?: string;
    email?: string;
    grade?: string;
    tags?: string[];
    createdBy?: string;
  },
) {
  return prisma.customer.create({
    data: {
      tenantId,
      name: data.name,
      contactName: data.contactName,
      taxId: data.taxId,
      phone: data.phone,
      zipCode: data.zipCode,
      address: data.address,
      paymentDays: data.paymentDays ?? 30,
      lineUserId: data.lineUserId,
      email: data.email,
      grade: data.grade ?? 'B',
      tags: data.tags ?? [],
      createdBy: data.createdBy,
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.CustomerUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.customer.update({
    where: { id },
    data,
  });
}

export async function deactivate(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.customer.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function findByName(
  tenantId: string,
  query: string,
  opts: { createdBy?: string } = {},
) {
  return prisma.customer.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { contactName: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 20,
  });
}

export async function getPaymentDays(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, paymentDays: true },
  });
  if (!customer) {
    throw new NotFoundError('Customer', customerId);
  }
  return customer;
}
