/**
 * Fiscal periods. 啟用會計模組時建立 12 期（月）；
 * 每期可由 ADMIN/ACCOUNTING 開關 closed 狀態。
 */
import { prisma } from '../../../shared/prisma.js';
import { ValidationError, NotFoundError } from '../../../shared/errors.js';

export async function list(tenantId: string, opts: { year?: number } = {}) {
  return prisma.fiscalPeriod.findMany({
    where: { tenantId, ...(opts.year ? { year: opts.year } : {}) },
    orderBy: [{ year: 'asc' }, { period: 'asc' }],
  });
}

/**
 * 建立會計年度的 12 個月期間。fiscalYearStartMonth=1 = Calendar Year。
 * 重跑同一年只會把缺的補上，已有的不動。
 */
export async function ensureYearPeriods(
  tenantId: string,
  year: number,
  fiscalYearStartMonth: number = 1,
): Promise<{ created: number }> {
  const existing = await prisma.fiscalPeriod.findMany({
    where: { tenantId, year },
    select: { period: true },
  });
  const have = new Set(existing.map((p) => p.period));
  let created = 0;
  for (let i = 0; i < 12; i++) {
    const period = i + 1; // 1-12
    if (have.has(period)) continue;
    const monthIdx = (fiscalYearStartMonth - 1 + i) % 12;
    const yearAdj = year + Math.floor((fiscalYearStartMonth - 1 + i) / 12);
    const startDate = new Date(Date.UTC(yearAdj, monthIdx, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(yearAdj, monthIdx + 1, 1, 0, 0, 0) - 1000);
    await prisma.fiscalPeriod.create({
      data: { tenantId, year, period, startDate, endDate, status: 'open' },
    });
    created++;
  }
  return { created };
}

export async function findPeriodForDate(tenantId: string, date: Date) {
  // 找 startDate <= date <= endDate
  return prisma.fiscalPeriod.findFirst({
    where: {
      tenantId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });
}

export async function close(tenantId: string, id: string, closedBy: string) {
  const p = await prisma.fiscalPeriod.findFirst({ where: { id, tenantId } });
  if (!p) throw new NotFoundError('期間不存在');
  if (p.status === 'closed') throw new ValidationError('已關閉');
  // 任何 pending 傳票需先 post 或 reject 才能關期
  const pending = await prisma.journalEntry.count({
    where: { tenantId, periodId: p.id, status: 'pending' },
  });
  if (pending > 0) throw new ValidationError(`尚有 ${pending} 筆待審核傳票，需先處理`);
  return prisma.fiscalPeriod.update({
    where: { id: p.id },
    data: { status: 'closed', closedAt: new Date(), closedBy },
  });
}

export async function reopen(tenantId: string, id: string) {
  const p = await prisma.fiscalPeriod.findFirst({ where: { id, tenantId } });
  if (!p) throw new NotFoundError('期間不存在');
  if (p.status === 'open') throw new ValidationError('已是開放狀態');
  return prisma.fiscalPeriod.update({
    where: { id: p.id },
    data: { status: 'open', closedAt: null, closedBy: null },
  });
}
