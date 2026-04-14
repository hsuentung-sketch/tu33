import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.supplier.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { name: 'asc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id, tenantId },
  });
  if (!supplier) {
    throw new NotFoundError('Supplier', id);
  }
  return supplier;
}

export async function create(
  tenantId: string,
  data: {
    name: string;
    type?: string;
    contactName?: string;
    taxId?: string;
    phone?: string;
    zipCode?: string;
    address?: string;
    paymentDays?: number;
    email?: string;
  },
) {
  return prisma.supplier.create({
    data: {
      tenantId,
      name: data.name,
      type: data.type,
      contactName: data.contactName,
      taxId: data.taxId,
      phone: data.phone,
      zipCode: data.zipCode,
      address: data.address,
      paymentDays: data.paymentDays ?? 60,
      email: data.email,
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.SupplierUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.supplier.update({
    where: { id },
    data,
  });
}

export async function deactivate(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.supplier.update({
    where: { id },
    data: { isActive: false },
  });
}
