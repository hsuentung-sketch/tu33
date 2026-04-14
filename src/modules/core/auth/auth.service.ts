import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function findEmployeeByLineUserId(lineUserId: string) {
  const employee = await prisma.employee.findUnique({
    where: { lineUserId },
    include: { tenant: true },
  });
  return employee;
}

export async function bindLineUser(
  tenantId: string,
  employeeId: string,
  lineUserId: string,
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
  });
  if (!employee) {
    throw new NotFoundError('Employee', employeeId);
  }

  return prisma.employee.update({
    where: { id: employeeId },
    data: { lineUserId },
  });
}

export async function getTenantByLineChannel(channelId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { lineChannelId: channelId },
  });
  if (!tenant) {
    throw new NotFoundError('Tenant');
  }
  return tenant;
}
