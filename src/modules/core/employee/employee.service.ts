import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.employee.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { employeeId: 'asc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const employee = await prisma.employee.findFirst({
    where: { id, tenantId },
  });
  if (!employee) {
    throw new NotFoundError('Employee', id);
  }
  return employee;
}

export async function create(
  tenantId: string,
  data: {
    employeeId: string;
    name: string;
    role?: 'ADMIN' | 'SALES' | 'PURCHASING' | 'ACCOUNTING' | 'VIEWER';
    phone?: string;
    email?: string;
    address?: string;
  },
) {
  return prisma.employee.create({
    data: {
      tenantId,
      employeeId: data.employeeId,
      name: data.name,
      role: data.role ?? 'VIEWER',
      phone: data.phone,
      email: data.email,
      address: data.address,
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.EmployeeUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.employee.update({
    where: { id },
    data,
  });
}

export async function deactivate(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.employee.update({
    where: { id },
    data: { isActive: false },
  });
}
