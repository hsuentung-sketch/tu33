/**
 * 會計報表 service：試算表 / 損益表 / 資產負債表
 *
 * 一律只算 status='posted' 的 JournalEntry。pending 不入帳。
 */
import { prisma } from '../../shared/prisma.js';

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
