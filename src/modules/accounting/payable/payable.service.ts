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
  data: { paidDate?: Date; invoiceNo?: string | null; note?: string },
) {
  const existing = await prisma.accountPayable.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw new NotFoundError('AccountPayable', id);

  // 以 isPaid=false 為條件更新：同時兩次付款只有一次成立，避免重複入帳。
  const r = await prisma.accountPayable.updateMany({
    where: { id, tenantId, isPaid: false },
    data: {
      isPaid: true,
      paidDate: data.paidDate ?? new Date(),
      invoiceNo: data.invoiceNo,
      note: data.note,
    },
  });
  if (r.count === 0) throw new ValidationError('此應付帳款已付款');
  const updated = await prisma.accountPayable.findUniqueOrThrow({ where: { id } });

  await eventBus.emitAsync('payment:received', {
    tenantId,
    paymentId: updated.id,
    invoiceId: updated.id,
    amount: Number(updated.amount),
  });

  return updated;
}

/**
 * Partial update — toggle isPaid, edit invoiceNo / paidDate / note at
 * any time. Mirrors receivable.update().
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
  actorId?: string,
) {
  const existing = await prisma.accountPayable.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('AccountPayable', id);

  const patch: Record<string, unknown> = {};
  if (data.isPaid !== undefined) patch.isPaid = data.isPaid;
  if (data.paidDate !== undefined) patch.paidDate = data.paidDate;
  if (data.invoiceNo !== undefined) patch.invoiceNo = data.invoiceNo;
  if (data.note !== undefined) patch.note = data.note;

  if (data.isPaid === true && !existing.isPaid && data.paidDate === undefined) {
    patch.paidDate = new Date();
  }
  if (data.isPaid === false && data.paidDate === undefined) {
    patch.paidDate = null;
  }

  // 以原 isPaid 為條件：期間被別人改過狀態就拒絕，避免付款/取消付款傳票錯亂。
  const r = await prisma.accountPayable.updateMany({
    where: { id, tenantId, isPaid: existing.isPaid },
    data: patch,
  });
  if (r.count === 0) throw new ValidationError('付款狀態已被其他人變更，請重新整理後再試');
  const updated = await prisma.accountPayable.findUniqueOrThrow({ where: { id } });

  if (!existing.isPaid && updated.isPaid) {
    await eventBus.emitAsync('payment:received', {
      tenantId, paymentId: updated.id, invoiceId: updated.id, amount: Number(updated.amount),
    });
  } else if (existing.isPaid && !updated.isPaid) {
    await eventBus.emitAsync('payment:unpaid', { tenantId, paymentId: updated.id, actorId });
  }
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
