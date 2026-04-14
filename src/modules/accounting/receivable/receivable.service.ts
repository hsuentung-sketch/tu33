import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { eventBus } from '../../../shared/event-bus.js';
import { getOverdueStatus, getTenantSettings } from '../../../shared/utils.js';

export async function list(
  tenantId: string,
  filters: { isPaid?: boolean; customerId?: string } = {},
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);

  const rows = await prisma.accountReceivable.findMany({
    where: {
      tenantId,
      ...(filters.isPaid !== undefined ? { isPaid: filters.isPaid } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    include: { customer: true, salesOrder: true },
    orderBy: { dueDate: 'asc' },
  });

  return rows.map((r) => ({
    ...r,
    overdueStatus: getOverdueStatus(r.dueDate, r.isPaid, settings.overdueAlertDays),
  }));
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.accountReceivable.findFirst({
    where: { id, tenantId },
    include: { customer: true, salesOrder: { include: { items: true } } },
  });
  if (!row) throw new NotFoundError('AccountReceivable', id);

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
  const existing = await prisma.accountReceivable.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw new NotFoundError('AccountReceivable', id);
  if (existing.isPaid) {
    throw new ValidationError('Receivable already marked paid');
  }

  const updated = await prisma.accountReceivable.update({
    where: { id },
    data: {
      isPaid: true,
      paidDate: data.paidDate ?? new Date(),
      invoiceNo: data.invoiceNo,
      note: data.note,
    },
  });

  eventBus.emit('invoice:paid', {
    tenantId,
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

  const rows = await prisma.accountReceivable.findMany({
    where: { tenantId, isPaid: false, dueDate: { lte: cutoff } },
    include: { customer: true, salesOrder: true },
    orderBy: { dueDate: 'asc' },
  });

  return rows.map((r) => ({
    ...r,
    overdueStatus: getOverdueStatus(r.dueDate, r.isPaid, settings.overdueAlertDays),
  }));
}
