/**
 * Journal Entry service.
 *
 * 傳票生命週期：pending → posted → (reversed)
 *  - pending：草稿，可改可刪
 *  - posted：已過帳，不可刪只能反沖
 *  - reversed：已被反沖（產生紅字傳票指向此筆）
 *
 * 借貸平衡檢核：SUM(debit) === SUM(credit)；任一筆 line 的 debit/credit 必須一者為 0。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { ValidationError, NotFoundError } from '../../../shared/errors.js';
import * as periodService from '../period/period.service.js';
import { assertTenantIsolation } from "../../../shared/tenant-isolation.js";

type Decimal = Prisma.Decimal;

interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  departmentId?: string | null;
}

interface JournalEntryInput {
  entryDate: Date;
  description: string;
  lines: JournalLineInput[];
  source?: string;
  sourceId?: string | null;
  status?: 'pending' | 'posted'; // 預設 pending；自動分錄/期初開帳可帶 posted
}

function toDecimal(n: number | undefined): number {
  return Number.isFinite(n) ? Number(n) : 0;
}

function validateLines(lines: JournalLineInput[]) {
  if (!lines || lines.length < 2) throw new ValidationError('傳票至少需 2 筆分錄');
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    const d = toDecimal(l.debit);
    const c = toDecimal(l.credit);
    if (d < 0 || c < 0) throw new ValidationError('金額不可為負');
    if (d > 0 && c > 0) throw new ValidationError('同一筆分錄借貸不可同時 > 0');
    if (d === 0 && c === 0) throw new ValidationError('同一筆分錄借貸不可同時為 0');
    totalDebit += d;
    totalCredit += c;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new ValidationError(`借貸不平衡：借 ${totalDebit} ≠ 貸 ${totalCredit}`);
  }
  return { totalDebit, totalCredit };
}

async function nextEntryNo(tenantId: string, entryDate: Date): Promise<string> {
  const yyyymmdd = `${entryDate.getFullYear()}${String(entryDate.getMonth() + 1).padStart(2, '0')}${String(entryDate.getDate()).padStart(2, '0')}`;
  const prefix = `JE-${yyyymmdd}-`;
  const last = await prisma.journalEntry.findFirst({
    where: { tenantId, entryNo: { startsWith: prefix } },
    orderBy: { entryNo: 'desc' },
    select: { entryNo: true },
  });
  const next = last ? Number(last.entryNo.split('-')[2]) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function create(tenantId: string, createdBy: string | null, input: JournalEntryInput) {
  assertTenantIsolation(tenantId, 'accounting');
  validateLines(input.lines);
  const period = await periodService.findPeriodForDate(tenantId, input.entryDate);
  if (!period) throw new ValidationError('找不到對應的會計期間，請先建立');
  if (period.status === 'closed') throw new ValidationError('該期間已關閉，無法新增傳票');

  const entryNo = await nextEntryNo(tenantId, input.entryDate);
  const status = input.status === 'posted' ? 'posted' : 'pending';
  return prisma.journalEntry.create({
    data: {
      tenantId, entryNo,
      entryDate: input.entryDate,
      periodId: period.id,
      description: input.description,
      source: input.source ?? 'manual',
      sourceId: input.sourceId ?? null,
      status,
      ...(status === 'posted' ? { postedAt: new Date(), postedBy: createdBy } : {}),
      createdBy,
      lines: {
        create: input.lines.map((l, i) => ({
          sequence: i + 1,
          accountId: l.accountId,
          debit: new Prisma.Decimal(toDecimal(l.debit)),
          credit: new Prisma.Decimal(toDecimal(l.credit)),
          description: l.description ?? null,
          departmentId: l.departmentId ?? null,
        })),
      },
    },
    include: { lines: { orderBy: { sequence: 'asc' } } },
  });
}

export async function list(tenantId: string, opts: {
  status?: string; periodId?: string; source?: string; from?: Date; to?: Date; limit?: number;
} = {}) {
  assertTenantIsolation(tenantId, 'accounting');
  return prisma.journalEntry.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.periodId ? { periodId: opts.periodId } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.from || opts.to ? {
        entryDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) },
      } : {}),
    },
    orderBy: { entryDate: 'desc' },
    take: opts.limit ?? 100,
    include: { lines: { include: { account: true }, orderBy: { sequence: 'asc' } } },
  });
}

export async function getById(tenantId: string, id: string) {
  assertTenantIsolation(tenantId, 'accounting');
  const e = await prisma.journalEntry.findFirst({
    where: { id, tenantId },
    include: { lines: { include: { account: true }, orderBy: { sequence: 'asc' } }, period: true },
  });
  if (!e) throw new NotFoundError('傳票不存在');
  return e;
}

export async function update(tenantId: string, id: string, input: Partial<JournalEntryInput>) {
  assertTenantIsolation(tenantId, 'accounting');
  const existing = await getById(tenantId, id);
  if (existing.status !== 'pending') throw new ValidationError('已過帳的傳票不可修改，需先反沖');
  if (input.lines) validateLines(input.lines);
  return prisma.$transaction(async (tx) => {
    if (input.lines) {
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      for (let i = 0; i < input.lines.length; i++) {
        const l = input.lines[i];
        await tx.journalLine.create({
          data: {
            entryId: id, sequence: i + 1,
            accountId: l.accountId,
            debit: new Prisma.Decimal(toDecimal(l.debit)),
            credit: new Prisma.Decimal(toDecimal(l.credit)),
            description: l.description ?? null,
            departmentId: l.departmentId ?? null,
          },
        });
      }
    }
    return tx.journalEntry.update({
      where: { id },
      data: {
        ...(input.entryDate ? { entryDate: input.entryDate } : {}),
        ...(input.description ? { description: input.description } : {}),
      },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
  });
}

export async function post(tenantId: string, id: string, postedBy: string) {
  assertTenantIsolation(tenantId, 'accounting');
  const e = await getById(tenantId, id);
  if (e.status === 'posted') throw new ValidationError('已過帳');
  if (e.status === 'reversed') throw new ValidationError('已反沖的傳票不可過帳');
  if (e.period.status === 'closed') throw new ValidationError('該期間已關閉');
  return prisma.journalEntry.update({
    where: { id },
    data: { status: 'posted', postedAt: new Date(), postedBy },
  });
}

export async function reverse(tenantId: string, id: string, reversedBy: string, reason?: string) {
  assertTenantIsolation(tenantId, 'accounting');
  const orig = await getById(tenantId, id);
  if (orig.status !== 'posted') throw new ValidationError('只能反沖已過帳的傳票');
  return prisma.$transaction(async (tx) => {
    // 建紅字傳票（debit/credit 對調）
    const period = await periodService.findPeriodForDate(tenantId, new Date());
    if (!period) throw new ValidationError('當日無對應期間');
    if (period.status === 'closed') throw new ValidationError('當期已關閉，無法產生反沖');
    const yyyymmdd = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
    const prefix = `JE-${yyyymmdd}-`;
    const last = await tx.journalEntry.findFirst({
      where: { tenantId, entryNo: { startsWith: prefix } },
      orderBy: { entryNo: 'desc' },
      select: { entryNo: true },
    });
    const next = last ? Number(last.entryNo.split('-')[2]) + 1 : 1;
    const newNo = `${prefix}${String(next).padStart(3, '0')}`;

    const reversal = await tx.journalEntry.create({
      data: {
        tenantId, entryNo: newNo, entryDate: new Date(),
        periodId: period.id,
        description: `反沖：${orig.entryNo}${reason ? `（${reason}）` : ''}`,
        source: 'reversal',
        sourceId: orig.id,
        status: 'posted',
        postedAt: new Date(), postedBy: reversedBy, createdBy: reversedBy,
        lines: {
          create: orig.lines.map((l, i) => ({
            sequence: i + 1,
            accountId: l.accountId,
            debit: l.credit, // 對調
            credit: l.debit,
            description: l.description,
            departmentId: l.departmentId,
          })),
        },
      },
      include: { lines: true },
    });
    await tx.journalEntry.update({
      where: { id: orig.id },
      data: {
        status: 'reversed',
        reversedAt: new Date(),
        reversedBy,
        reversedById: reversal.id,
      },
    });
    return reversal;
  });
}

export async function remove(tenantId: string, id: string) {
  assertTenantIsolation(tenantId, 'accounting');
  const e = await getById(tenantId, id);
  if (e.status !== 'pending') throw new ValidationError('只能刪除 pending 傳票');
  await prisma.journalEntry.delete({ where: { id } });
}
