/**
 * 會計報表 service：試算表 / 損益表 / 資產負債表 / 總分類帳 / 現金流量表 / 帳齡分析
 *
 * 一律只算 status='posted' 的 JournalEntry。pending 不入帳。
 */
import { prisma } from '../../shared/prisma.js';
import { SYSTEM_ACCOUNT_CODES } from './coa/default-coa-template.js';

interface AccountBalance {
  id: string;
  code: string;
  name: string;
  type: string;
  normalSide: string;
  totalDebit: number;
  totalCredit: number;
  /** debit - credit；asset/expense/cost 期望 > 0，liability/equity/income 期望 < 0 */
  netDebit: number;
  /** 依正常餘額方向呈現的數字，給報表 UI 用 */
  balance: number;
}

async function balancesByPeriod(tenantId: string, opts: {
  from?: Date;
  to?: Date;
}): Promise<AccountBalance[]> {
  const where: any = { entry: { tenantId, status: 'posted' } };
  if (opts.from || opts.to) {
    where.entry.entryDate = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    };
  }
  const lines = await prisma.journalLine.findMany({
    where,
    include: { account: true },
  });
  const map = new Map<string, AccountBalance>();
  for (const l of lines) {
    const a = l.account;
    if (!map.has(a.id)) {
      map.set(a.id, {
        id: a.id, code: a.code, name: a.name,
        type: a.type, normalSide: a.normalSide,
        totalDebit: 0, totalCredit: 0, netDebit: 0, balance: 0,
      });
    }
    const b = map.get(a.id)!;
    b.totalDebit += Number(l.debit);
    b.totalCredit += Number(l.credit);
  }
  for (const b of map.values()) {
    b.netDebit = b.totalDebit - b.totalCredit;
    b.balance = b.normalSide === 'debit' ? b.netDebit : -b.netDebit;
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** 試算表 — 整年/期間所有科目借貸彙總 */
export async function trialBalance(tenantId: string, opts: { from?: Date; to?: Date } = {}) {
  const balances = await balancesByPeriod(tenantId, opts);
  const totalDebit = balances.reduce((s, b) => s + b.totalDebit, 0);
  const totalCredit = balances.reduce((s, b) => s + b.totalCredit, 0);
  return { balances, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 };
}

/** 損益表 — 期間區間（通常是月/季/年） */
export async function incomeStatement(tenantId: string, from: Date, to: Date) {
  const balances = await balancesByPeriod(tenantId, { from, to });
  const income = balances.filter((b) => b.type === 'income');
  const cost = balances.filter((b) => b.type === 'cost');
  const expense = balances.filter((b) => b.type === 'expense');
  const totalIncome = income.reduce((s, b) => s + b.balance, 0);
  const totalCost = cost.reduce((s, b) => s + b.balance, 0);
  const totalExpense = expense.reduce((s, b) => s + b.balance, 0);
  const grossProfit = totalIncome - totalCost;
  const netIncome = grossProfit - totalExpense;
  return {
    from, to,
    income, cost, expense,
    totalIncome, totalCost, totalExpense,
    grossProfit, netIncome,
  };
}

/** 資產負債表 — 期末快照（從 createdAt 起到 asOf） */
export async function balanceSheet(tenantId: string, asOf: Date) {
  const balances = await balancesByPeriod(tenantId, { to: asOf });
  const asset = balances.filter((b) => b.type === 'asset');
  const liability = balances.filter((b) => b.type === 'liability');
  const equity = balances.filter((b) => b.type === 'equity');

  // 算本期淨利（從 income/cost/expense 自最近會計年度起）
  const startOfYear = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  const ytd = await incomeStatement(tenantId, startOfYear, asOf);

  const totalAsset = asset.reduce((s, b) => s + b.balance, 0);
  const totalLiability = liability.reduce((s, b) => s + b.balance, 0);
  const totalEquityBeforeIncome = equity.reduce((s, b) => s + b.balance, 0);
  const totalEquity = totalEquityBeforeIncome + ytd.netIncome;
  return {
    asOf,
    asset, liability, equity,
    netIncomeYTD: ytd.netIncome,
    totalAsset, totalLiability, totalEquity,
    balanced: Math.abs(totalAsset - (totalLiability + totalEquity)) < 0.005,
  };
}

// ─────────────────────────────────────────────────────────────
// 總分類帳 (General Ledger)
// ─────────────────────────────────────────────────────────────

interface GLLine {
  date: Date;
  entryNo: string;
  entryId: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface GLAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  normalSide: string;
  openingBalance: number;
  lines: GLLine[];
  closingBalance: number;
}

/**
 * 總分類帳 — 各科目在期間內的逐筆明細 + 期初/期末餘額。
 * accountCode 可選：傳入時只回單一科目，不傳回全部有異動的科目。
 */
export async function generalLedger(
  tenantId: string,
  from: Date,
  to: Date,
  accountCode?: string,
) {
  const accountWhere = accountCode
    ? { account: { tenantId, code: accountCode } }
    : {};

  // 期初餘額（from 之前的所有 posted JE）
  const priorLines = await prisma.journalLine.findMany({
    where: {
      ...accountWhere,
      entry: { tenantId, status: 'posted', entryDate: { lt: from } },
    },
    include: { account: true },
  });

  const openingMap = new Map<string, { debit: number; credit: number; account: any }>();
  for (const l of priorLines) {
    if (!openingMap.has(l.accountId)) {
      openingMap.set(l.accountId, { debit: 0, credit: 0, account: l.account });
    }
    const o = openingMap.get(l.accountId)!;
    o.debit += Number(l.debit);
    o.credit += Number(l.credit);
  }

  // 期間內的 posted JE lines
  const periodLines = await prisma.journalLine.findMany({
    where: {
      ...accountWhere,
      entry: { tenantId, status: 'posted', entryDate: { gte: from, lte: to } },
    },
    include: { account: true, entry: { select: { id: true, entryNo: true, entryDate: true, description: true } } },
    orderBy: [{ entry: { entryDate: 'asc' } }, { sequence: 'asc' }],
  });

  // 彙整各科目
  const glMap = new Map<string, GLAccount>();

  for (const [accId, o] of openingMap) {
    const net = o.debit - o.credit;
    const bal = o.account.normalSide === 'debit' ? net : -net;
    glMap.set(accId, {
      accountId: accId, code: o.account.code, name: o.account.name,
      type: o.account.type, normalSide: o.account.normalSide,
      openingBalance: bal, lines: [], closingBalance: bal,
    });
  }

  for (const l of periodLines) {
    if (!glMap.has(l.accountId)) {
      glMap.set(l.accountId, {
        accountId: l.accountId, code: l.account.code, name: l.account.name,
        type: l.account.type, normalSide: l.account.normalSide,
        openingBalance: 0, lines: [], closingBalance: 0,
      });
    }
    const gl = glMap.get(l.accountId)!;
    const d = Number(l.debit);
    const c = Number(l.credit);
    const delta = gl.normalSide === 'debit' ? d - c : c - d;
    gl.closingBalance += delta;
    gl.lines.push({
      date: l.entry.entryDate, entryNo: l.entry.entryNo, entryId: l.entry.id,
      description: l.entry.description, debit: d, credit: c,
      runningBalance: gl.closingBalance,
    });
  }

  const accounts = [...glMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { from, to, accounts };
}

// ─────────────────────────────────────────────────────────────
// 現金流量表 (Cash Flow Statement) — 直接法
// ─────────────────────────────────────────────────────────────

interface CashFlowItem {
  entryId: string;
  entryNo: string;
  date: Date;
  description: string;
  amount: number;
  source: string;
  counterAccounts: string[];
}

export async function cashFlowStatement(tenantId: string, from: Date, to: Date) {
  const cashCodes = [SYSTEM_ACCOUNT_CODES.CASH, SYSTEM_ACCOUNT_CODES.BANK];
  const cashAccounts = await prisma.chartOfAccount.findMany({
    where: { tenantId, code: { in: cashCodes } },
    select: { id: true },
  });
  const cashIds = new Set(cashAccounts.map((a) => a.id));
  if (cashIds.size === 0) return { from, to, items: [], openingCash: 0, totalInflow: 0, totalOutflow: 0, netCashFlow: 0, closingCash: 0 };

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: [...cashIds] },
      entry: { tenantId, status: 'posted', entryDate: { gte: from, lte: to } },
    },
    include: {
      entry: {
        select: { id: true, entryNo: true, entryDate: true, description: true, source: true },
        include: { lines: { include: { account: { select: { id: true, code: true, name: true } } } } },
      },
    },
    orderBy: { entry: { entryDate: 'asc' } },
  });

  const items: CashFlowItem[] = [];
  const seen = new Set<string>();

  for (const l of lines) {
    if (seen.has(l.entry.id)) continue;
    seen.add(l.entry.id);
    let cashDelta = 0;
    const counterAccts: string[] = [];
    for (const el of l.entry.lines) {
      if (cashIds.has(el.accountId)) {
        cashDelta += Number(el.debit) - Number(el.credit);
      } else {
        counterAccts.push(`${el.account.code} ${el.account.name}`);
      }
    }
    items.push({
      entryId: l.entry.id, entryNo: l.entry.entryNo, date: l.entry.entryDate,
      description: l.entry.description, amount: cashDelta,
      source: l.entry.source, counterAccounts: [...new Set(counterAccts)],
    });
  }

  const totalInflow = items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const totalOutflow = items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const netCashFlow = totalInflow + totalOutflow;

  const priorCashLines = await prisma.journalLine.findMany({
    where: { accountId: { in: [...cashIds] }, entry: { tenantId, status: 'posted', entryDate: { lt: from } } },
  });
  const openingCash = priorCashLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

  return { from, to, openingCash, items, totalInflow, totalOutflow, netCashFlow, closingCash: openingCash + netCashFlow };
}

// ─────────────────────────────────────────────────────────────
// 帳齡分析 (Aging Analysis)
// ─────────────────────────────────────────────────────────────

interface AgingBucket { label: string; count: number; amount: number; }
interface AgingRow {
  id: string; counterpartyId: string; counterpartyName: string;
  amount: number; dueDate: Date; daysOverdue: number; bucket: string; orderNo: string;
}

function assignBucket(days: number): string {
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function bucketLabel(key: string): string {
  const m: Record<string, string> = { current: '未到期', '1-30': '1-30 天', '31-60': '31-60 天', '61-90': '61-90 天', '90+': '90 天以上' };
  return m[key] ?? key;
}

function buildBuckets(items: AgingRow[]): AgingBucket[] {
  return ['current', '1-30', '31-60', '61-90', '90+'].map((key) => {
    const matched = items.filter((i) => i.bucket === key);
    return { label: bucketLabel(key), count: matched.length, amount: matched.reduce((s, i) => s + i.amount, 0) };
  });
}

/** 應收帳齡分析 */
export async function arAging(tenantId: string, asOf?: Date) {
  const ref = asOf ?? new Date();
  const rows = await prisma.accountReceivable.findMany({
    where: { tenantId, isPaid: false },
    include: { customer: { select: { name: true } }, salesOrder: { select: { orderNo: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const items: AgingRow[] = rows.map((r) => {
    const days = Math.floor((ref.getTime() - r.dueDate.getTime()) / 86400000);
    return {
      id: r.id, counterpartyId: r.customerId, counterpartyName: r.customer.name,
      amount: Number(r.amount), dueDate: r.dueDate, daysOverdue: Math.max(0, days),
      bucket: assignBucket(days), orderNo: r.salesOrder.orderNo,
    };
  });
  return { asOf: ref, items, buckets: buildBuckets(items), totalOutstanding: items.reduce((s, i) => s + i.amount, 0) };
}

/** 應付帳齡分析 */
export async function apAging(tenantId: string, asOf?: Date) {
  const ref = asOf ?? new Date();
  const rows = await prisma.accountPayable.findMany({
    where: { tenantId, isPaid: false },
    include: { supplier: { select: { name: true } }, purchaseOrder: { select: { orderNo: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const items: AgingRow[] = rows.map((r) => {
    const days = Math.floor((ref.getTime() - r.dueDate.getTime()) / 86400000);
    return {
      id: r.id, counterpartyId: r.supplierId, counterpartyName: r.supplier.name,
      amount: Number(r.amount), dueDate: r.dueDate, daysOverdue: Math.max(0, days),
      bucket: assignBucket(days), orderNo: r.purchaseOrder.orderNo,
    };
  });
  return { asOf: ref, items, buckets: buildBuckets(items), totalOutstanding: items.reduce((s, i) => s + i.amount, 0) };
}

// ─────────────────────────────────────────────────────────────
// 稅務扣抵報表 (Tax Deduction Report)
// 供每月申報進項稅額、扣繳及營所稅時使用
// ─────────────────────────────────────────────────────────────

export interface TaxDeductEntry {
  entryId: string;
  entryNo: string;
  entryDate: Date;
  description: string;
  amount: number;
  vatDeductType: string;
  vatInputAmount: number;
  deductibleVat: number;
  withholdingTax: number;
  voucherNo: string | null;
}

export interface TaxDeductMonthlySummary {
  year: number;
  month: number;
  totalAmount: number;
  totalVatInput: number;
  totalDeductibleVat: number;
  totalWithholding: number;
  deductRatio: number;
  entries: TaxDeductEntry[];
}

export interface TaxDeductReport {
  year: number;
  month?: number;
  monthly: TaxDeductMonthlySummary[];
  annual: {
    totalAmount: number;
    totalVatInput: number;
    totalDeductibleVat: number;
    totalWithholding: number;
  };
}

export async function taxDeductionReport(
  tenantId: string,
  year: number,
  month?: number,
): Promise<TaxDeductReport> {
  const fromMonth = month ?? 1;
  const toMonth = month ?? 12;
  const from = new Date(Date.UTC(year, fromMonth - 1, 1));
  const to = new Date(Date.UTC(year, toMonth, 0, 23, 59, 59));

  const entries = await prisma.journalEntry.findMany({
    where: {
      tenantId,
      source: 'expense',
      status: 'posted',
      entryDate: { gte: from, lte: to },
    },
    include: {
      lines: {
        include: { account: { select: { type: true, code: true } } },
      },
    },
    orderBy: { entryDate: 'asc' },
  });

  const rows: TaxDeductEntry[] = entries.map((e) => {
    const amount = e.lines
      .filter((l) => l.account.type === 'expense' || l.account.type === 'cost')
      .reduce((s, l) => s + Number(l.debit), 0);
    return {
      entryId: e.id,
      entryNo: e.entryNo,
      entryDate: e.entryDate,
      description: e.description,
      amount,
      vatDeductType: e.vatDeductType ?? 'review',
      vatInputAmount: Number(e.vatInputAmount ?? 0),
      deductibleVat: Number(e.deductibleVat ?? 0),
      withholdingTax: Number(e.withholdingTax ?? 0),
      voucherNo: e.sourceId ?? null,
    };
  });

  const monthMap = new Map<number, TaxDeductEntry[]>();
  for (const r of rows) {
    const m = r.entryDate.getUTCMonth() + 1;
    if (!monthMap.has(m)) monthMap.set(m, []);
    monthMap.get(m)!.push(r);
  }

  const monthly: TaxDeductMonthlySummary[] = [];
  for (let m = fromMonth; m <= toMonth; m++) {
    const mes = monthMap.get(m) ?? [];
    const totalAmount = mes.reduce((s, r) => s + r.amount, 0);
    const totalVatInput = mes.reduce((s, r) => s + r.vatInputAmount, 0);
    const totalDeductibleVat = mes.reduce((s, r) => s + r.deductibleVat, 0);
    const totalWithholding = mes.reduce((s, r) => s + r.withholdingTax, 0);
    monthly.push({
      year, month: m,
      totalAmount,
      totalVatInput: Math.round(totalVatInput * 100) / 100,
      totalDeductibleVat: Math.round(totalDeductibleVat * 100) / 100,
      totalWithholding: Math.round(totalWithholding * 100) / 100,
      deductRatio: totalAmount > 0 ? Math.round(totalDeductibleVat / totalAmount * 10000) / 100 : 0,
      entries: mes,
    });
  }

  const annual = {
    totalAmount: monthly.reduce((s, m) => s + m.totalAmount, 0),
    totalVatInput: Math.round(monthly.reduce((s, m) => s + m.totalVatInput, 0) * 100) / 100,
    totalDeductibleVat: Math.round(monthly.reduce((s, m) => s + m.totalDeductibleVat, 0) * 100) / 100,
    totalWithholding: Math.round(monthly.reduce((s, m) => s + m.totalWithholding, 0) * 100) / 100,
  };

  return { year, month, monthly, annual };
}

// ─────────────────────────────────────────────────────────────
// 零用金月結 (Petty Cash Monthly Statement)
// ─────────────────────────────────────────────────────────────

export interface PettyCashLine {
  entryId: string;
  entryNo: string;
  entryDate: Date;
  description: string;
  source: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface PettyCashMonthlyStatement {
  year: number;
  month: number;
  openingBalance: number;
  lines: PettyCashLine[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  totalExpense: number;
  totalReplenishment: number;
}

export async function pettyCashMonthly(
  tenantId: string,
  year: number,
  month: number,
): Promise<PettyCashMonthlyStatement> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const cashAcct = await prisma.chartOfAccount.findFirst({
    where: { tenantId, code: '1101', isActive: true },
    select: { id: true },
  });
  if (!cashAcct) {
    return { year, month, openingBalance: 0, lines: [], totalDebit: 0, totalCredit: 0, closingBalance: 0, totalExpense: 0, totalReplenishment: 0 };
  }

  const priorLines = await prisma.journalLine.findMany({
    where: {
      accountId: cashAcct.id,
      entry: { tenantId, status: 'posted', entryDate: { lt: from } },
    },
  });
  const openingBalance = priorLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

  const periodLines = await prisma.journalLine.findMany({
    where: {
      accountId: cashAcct.id,
      entry: { tenantId, status: 'posted', entryDate: { gte: from, lte: to } },
    },
    include: {
      entry: { select: { id: true, entryNo: true, entryDate: true, description: true, source: true } },
    },
    orderBy: [{ entry: { entryDate: 'asc' } }, { sequence: 'asc' }],
  });

  let runningBalance = openingBalance;
  const lines: PettyCashLine[] = periodLines.map((l) => {
    const d = Number(l.debit);
    const c = Number(l.credit);
    runningBalance += d - c;
    return {
      entryId: l.entry.id,
      entryNo: l.entry.entryNo,
      entryDate: l.entry.entryDate,
      description: l.entry.description,
      source: l.entry.source,
      debit: d,
      credit: c,
      balance: Math.round(runningBalance * 100) / 100,
    };
  });

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const totalExpense = lines.filter((l) => l.source === 'expense').reduce((s, l) => s + l.credit, 0);
  const totalReplenishment = lines.filter((l) => l.source === 'petty_cash').reduce((s, l) => s + l.debit, 0);

  return {
    year, month,
    openingBalance: Math.round(openingBalance * 100) / 100,
    lines,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    closingBalance: Math.round(runningBalance * 100) / 100,
    totalExpense: Math.round(totalExpense * 100) / 100,
    totalReplenishment: Math.round(totalReplenishment * 100) / 100,
  };
}
