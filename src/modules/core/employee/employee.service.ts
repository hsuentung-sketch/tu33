import type { Employee, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';

/**
 * Public shape returned to the admin UI. `passwordHash` is NEVER
 * exposed; the UI only needs a boolean "does this employee have a
 * web-console password?" plus when it was last set.
 */
export type PublicEmployee = Omit<Employee, 'passwordHash'> & {
  hasPassword: boolean;
};

function toPublic(emp: Employee): PublicEmployee {
  const { passwordHash, ...rest } = emp;
  return { ...rest, hasPassword: !!passwordHash };
}

const MIN_PASSWORD_LEN = 8;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LEN) {
    throw new ValidationError(`密碼至少 ${MIN_PASSWORD_LEN} 碼`);
  }
  return bcrypt.hash(plain, 10);
}

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<PublicEmployee[]> {
  const rows = await prisma.employee.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { employeeId: 'asc' },
  });
  return rows.map(toPublic);
}

export async function getById(tenantId: string, id: string): Promise<PublicEmployee> {
  const employee = await prisma.employee.findFirst({
    where: { id, tenantId },
  });
  if (!employee) {
    throw new NotFoundError('Employee', id);
  }
  return toPublic(employee);
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
    password?: string;
  },
): Promise<PublicEmployee> {
  const passwordHash = data.password ? await hashPassword(data.password) : null;
  const row = await prisma.employee.create({
    data: {
      tenantId,
      employeeId: data.employeeId,
      name: data.name,
      role: data.role ?? 'VIEWER',
      phone: data.phone,
      email: data.email,
      address: data.address,
      passwordHash,
      passwordSetAt: passwordHash ? new Date() : null,
    },
  });
  return toPublic(row);
}

/**
 * Update basic fields. Password handling is separate — see `setPassword`
 * and `clearPassword` — to keep the ADMIN-only permission check localized
 * in the router.
 */
export async function update(
  tenantId: string,
  id: string,
  data: Prisma.EmployeeUpdateInput,
): Promise<PublicEmployee> {
  await getById(tenantId, id);
  const row = await prisma.employee.update({ where: { id }, data });
  return toPublic(row);
}

export async function setPassword(
  tenantId: string,
  id: string,
  newPassword: string,
): Promise<PublicEmployee> {
  await getById(tenantId, id);
  const hash = await hashPassword(newPassword);
  const row = await prisma.employee.update({
    where: { id },
    data: { passwordHash: hash, passwordSetAt: new Date() },
  });
  return toPublic(row);
}

export async function clearPassword(
  tenantId: string,
  id: string,
): Promise<PublicEmployee> {
  await getById(tenantId, id);
  const row = await prisma.employee.update({
    where: { id },
    data: { passwordHash: null, passwordSetAt: null },
  });
  return toPublic(row);
}

export async function deactivate(tenantId: string, id: string): Promise<PublicEmployee> {
  await getById(tenantId, id);
  const row = await prisma.employee.update({
    where: { id },
    data: { isActive: false },
  });
  return toPublic(row);
}
