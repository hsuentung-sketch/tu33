/**
 * 工作日誌 / 拜訪紀錄 service。
 *
 * 業務員每次拜訪客戶留一筆紀錄：日期、客戶、內容、（選填）下次行動日。
 * SALES 角色只看自己 createdByEmployeeId 的紀錄；ADMIN / ACCOUNTING / VIEWER 全看。
 */
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';

export interface VisitLogInput {
  visitDate: Date;
  customerId: string;
  content: string;
  nextActionDate?: Date | null;
  createdByEmployeeId?: string | null;
}

export interface VisitLogFilter {
  from?: Date;
  to?: Date;
  customerId?: string;
  employeeId?: string;
  limit?: number;
}

export async function list(tenantId: string, filter: VisitLogFilter = {}) {
  const where: Record<string, unknown> = { tenantId };
  if (filter.customerId) where.customerId = filter.customerId;
  if (filter.employeeId) where.createdByEmployeeId = filter.employeeId;
  if (filter.from || filter.to) {
    where.visitDate = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  return prisma.visitLog.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      createdByEmployee: { select: { id: true, name: true, employeeId: true } },
    },
    orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
    take: filter.limit ?? 200,
  });
}

export async function getById(tenantId: string, id: string) {
  const log = await prisma.visitLog.findFirst({
    where: { id, tenantId },
    include: {
      customer: { select: { id: true, name: true } },
      createdByEmployee: { select: { id: true, name: true, employeeId: true } },
    },
  });
  if (!log) throw new NotFoundError('VisitLog', id);
  return log;
}

export async function create(tenantId: string, input: VisitLogInput) {
  if (!input.content || input.content.trim().length === 0) {
    throw new ValidationError('拜訪內容不可空白');
  }
  // 確認客戶存在於該 tenant
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, tenantId },
    select: { id: true },
  });
  if (!customer) throw new NotFoundError('Customer', input.customerId);

  return prisma.visitLog.create({
    data: {
      tenantId,
      visitDate: input.visitDate,
      customerId: input.customerId,
      content: input.content,
      nextActionDate: input.nextActionDate ?? null,
      createdByEmployeeId: input.createdByEmployeeId ?? null,
    },
    include: {
      customer: { select: { id: true, name: true } },
      createdByEmployee: { select: { id: true, name: true, employeeId: true } },
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  input: Partial<VisitLogInput>,
) {
  await getById(tenantId, id);
  return prisma.visitLog.update({
    where: { id },
    data: {
      ...(input.visitDate !== undefined ? { visitDate: input.visitDate } : {}),
      ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.nextActionDate !== undefined ? { nextActionDate: input.nextActionDate } : {}),
    },
    include: {
      customer: { select: { id: true, name: true } },
      createdByEmployee: { select: { id: true, name: true, employeeId: true } },
    },
  });
}

export async function remove(tenantId: string, id: string) {
  await getById(tenantId, id);
  await prisma.visitLog.delete({ where: { id } });
}

/** SALES 規則：自己建的（createdByEmployeeId === me.id）或 null（歷史資料）公開。 */
export function canSalesAccess(
  log: { createdByEmployeeId: string | null },
  meId: string,
): boolean {
  return log.createdByEmployeeId === null || log.createdByEmployeeId === meId;
}
