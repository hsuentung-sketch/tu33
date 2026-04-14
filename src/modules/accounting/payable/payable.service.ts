import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { eventBus } from '../../../shared/event-bus.js';
import { getOverdueStatus, getTenantSettings } from '../../../shared/utils.js';

export async function list(
  tenantId: string,
  filters: { isPaid?: boolean; supplierId?: string } = {},
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);

  const rows = await prisma.accountPayable.findMany({
    where: {
      tenantId,
      ...(filters.isPaid !== undefined ? { isPaid: filters.isPaid } : {}),
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    },
    include: { supplier: true, purchaseOrder: true },
    orderBy: { dueDate: 'asc' },
  });

  return rows.map((r) => ({
    ...r,
    overdueStatus: getOverdueStatus(r.dueDate, r.isPaid, settings.overdueAlertDays),
  }));
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.accountPayable.findFirst({
    where: { id, tenantId },
    include: { supplier: true, purchaseOrder: { include: { items: true } } },
  });
  if (!row) throw new NotFoundError('AccountPayable', id);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);
  return {
    ...row,
    overdueStatus: getOverdueStatus(row.dueDate, row.isPaid, settings.overdueAlertDays),
  };
}

export async function markPaid(
  tenantId: string,
  id: string,
  data: { paidDate?: Date; invoiceNo?: string; note?: string },
) {
  const existing = await prisma.accountPayable.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw new NotFoundError('AccountPayable', id);
  if (existing.isPaid) {
    throw new ValidationError('Payable already marked paid');
  }

  const updated = await prisma.accountPayable.update({
    where: { id },
    data: {
      isPaid: true,
      paidDate: data.paidDate ?? new Date(),
      invoiceNo: data.invoiceNo,
      note: data.note,
    },
  });

  eventBus.emit('payment:received', {
    tenantId,
    paymentId: updated.id,
    invoiceId: updated.id,
    amount: Number(updated.amount),
  });

  return updated;
}

export async function getOverdue(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + settings.overdueAlertDays);

  const rows = await prisma.accountPayable.findMany({
    where: { tenantId, isPaid: false, dueDate: { lte: cutoff } },
    include: { supplier: true, purchaseOrder: true },
    orderBy: { dueDate: 'asc' },
  });

  return rows.map((r) => ({
    ...r,
    overdueStatus: getOverdueStatus(r.dueDate, r.isPaid, settings.overdueAlertDays),
  }));
}
