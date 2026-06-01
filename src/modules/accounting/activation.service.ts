/**
 * 會計模組啟用流程：
 *  1. 種子預設科目（DEFAULT_COA → ChartOfAccount）
 *  2. 建立當前會計年度的 12 個 FiscalPeriod
 *  3. flip Tenant.settings.accounting.enabled = true
 *
 * 期初餘額由 ADMIN 在另一個表單輸入後，由 createOpeningBalance 建立 source='opening'
 * 的 posted 傳票（status=posted 一次到位，因為期初不需審核）。
 */
import { prisma } from '../../shared/prisma.js';
import { ValidationError } from '../../shared/errors.js';
import { getTenantSettings } from '../../shared/utils.js';
import * as coaService from './coa/coa.service.js';
import * as periodService from './period/period.service.js';
import * as journalService from './journal/journal.service.js';
import { assertTenantIsolation } from "../../shared/tenant-isolation.js";

export async function isEnabled(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return getTenantSettings(t?.settings).accounting.enabled;
}

export async function activate(tenantId: string, opts: {
  fiscalYearStartMonth?: number; year?: number;
}): Promise<{ inserted: number; periodsCreated: number }> {
  const fiscalYearStartMonth = opts.fiscalYearStartMonth ?? 1;
  const year = opts.year ?? new Date().getFullYear();

  const seed = await coaService.seedDefaultTemplate(tenantId);
  const periods = await periodService.ensureYearPeriods(tenantId, year, fiscalYearStartMonth);

  // flip enabled
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const rawSettings = (typeof t?.settings === 'object' && t?.settings !== null)
    ? (t.settings as Record<string, unknown>) : {};
  const current = getTenantSettings(t?.settings).accounting;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        ...rawSettings,
        accounting: {
          ...current,
          enabled: true,
          fiscalYearStartMonth,
          currentYear: year,
        },
      } as unknown as object,
    },
  });
  return { inserted: seed.inserted, periodsCreated: periods.created };
}

/**
 * 建立期初餘額傳票。輸入 lines 為各科目期初借/貸；總借 = 總貸（差額由 capital 自動補）。
 * 傳票 source='opening'，status='posted'。
 *
 * 簡化版：給單筆「現金 XXX / 業主資本 XXX」即可走通。
 */
export async function createOpeningBalance(tenantId: string, createdBy: string, input: {
  entryDate: Date;
  description?: string;
  lines: Array<{ accountCode: string; debit?: number; credit?: number; description?: string }>;
}) {
  if (!input.lines || input.lines.length < 2) {
    throw new ValidationError('期初餘額至少需 2 筆分錄（如：現金 / 業主資本）');
  }
  // 找科目 id
  const codes = [...new Set(input.lines.map((l) => l.accountCode))];
  const accounts = await prisma.chartOfAccount.findMany({
    where: { tenantId, code: { in: codes } },
  });
  const codeToId = new Map<string, string>(accounts.map((a) => [a.code, a.id] as [string, string]));
  for (const c of codes) {
    if (!codeToId.has(c)) throw new ValidationError(`科目 ${c} 不存在`);
  }
  const lines = input.lines.map((l) => ({
    accountId: codeToId.get(l.accountCode) as string,
    debit: l.debit,
    credit: l.credit,
    description: l.description,
  }));
  const entry = await journalService.create(tenantId, createdBy, {
    entryDate: input.entryDate,
    description: input.description ?? '期初開帳',
    source: 'opening',
    sourceId: null,
    status: 'posted',
    lines,
  });

  // mark openingBalanceDone
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const rawSettings = (typeof t?.settings === 'object' && t?.settings !== null)
    ? (t.settings as Record<string, unknown>) : {};
  const current = getTenantSettings(t?.settings).accounting;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        ...rawSettings,
        accounting: { ...current, openingBalanceDone: true },
      } as unknown as object,
    },
  });
  return entry;
}
