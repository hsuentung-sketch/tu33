import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean; createdBy?: string } = {},
) {
  // Explicit select — see findByName for why (createdBy column may not
  // yet exist on production DB). Keep list callers (management handler,
  // master handler) unaffected by schema drift.
  return prisma.customer.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
    },
    select: {
      id: true,
      name: true,
      contactName: true,
      phone: true,
      email: true,
      taxId: true,
      zipCode: true,
      address: true,
      paymentDays: true,
      grade: true,
      tags: true,
      isActive: true,
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
  // Schema has `createdBy` on all tenant DBs since 2026-03; the P2022
  // retry hack is no longer needed.
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
  // Explicit select: keeps the LIFF autocomplete payload small AND
  // protects against the case where a newly-added column (e.g.
  // `createdBy`) hasn't been pushed to the production DB yet — the
  // default `findMany` without `select` would SELECT every column and
  // 500 on the missing one.
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
    select: {
      id: true,
      name: true,
      contactName: true,
      phone: true,
      email: true,
      taxId: true,
      zipCode: true,
      address: true,
      paymentDays: true,
      grade: true,
      tags: true,
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
