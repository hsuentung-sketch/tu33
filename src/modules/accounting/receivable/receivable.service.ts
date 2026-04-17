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

/**
 * Partial update — any field can be changed at any time (including
 * toggling isPaid, editing invoiceNo, paidDate, note). Unlike markPaid
 * this does NOT require the row to be unpaid. Used from admin 編輯 modal.
 */
export async function update(
  tenantId: string,
  id: string,
  data: {
    isPaid?: boolean;
    paidDate?: Date | null;
    invoiceNo?: string | null;
    note?: string | null;
  },
) {
  const existing = await prisma.accountReceivable.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('AccountReceivable', id);

  const patch: Record<string, unknown> = {};
  if (data.isPaid !== undefined) patch.isPaid = data.isPaid;
  if (data.paidDate !== undefined) patch.paidDate = data.paidDate;
  if (data.invoiceNo !== undefined) patch.invoiceNo = data.invoiceNo;
  if (data.note !== undefined) patch.note = data.note;

  // Implicit rule: toggling isPaid=true without paidDate → default to today.
  if (data.isPaid === true && !existing.isPaid && data.paidDate === undefined) {
    patch.paidDate = new Date();
  }
  // Reverse: unmark-paid clears paidDate unless explicitly kept.
  if (data.isPaid === false && data.paidDate === undefined) {
    patch.paidDate = null;
  }

  const updated = await prisma.accountReceivable.update({ where: { id }, data: patch });

  // Emit paid event on transition false→true so downstream hooks still fire.
  if (!existing.isPaid && updated.isPaid) {
    eventBus.emit('invoice:paid', {
      tenantId, invoiceId: updated.id, amount: Number(updated.amount),
    });
  }
  return updated;
}

/**
 * Electronic invoice issuance stub.
 *
 * Placeholder for future integration with 財政部電子發票 / ECPay / 綠界 /
 * etc. Currently returns { ok:false, status:'not_implemented' } so that
 * the frontend can probe for capability. When wiring a real provider,
 * implement below and persist the returned invoice number into
 * `AccountReceivable.invoiceNo`.
 */
export async function issueEinvoice(tenantId: string, id: string) {
  const existing = await getById(tenantId, id);
  return {
    ok: false,
    status: 'not_implemented',
    message: '電子發票自動開立尚未串接，請手動填寫發票號碼。',
    receivableId: existing.id,
  };
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
