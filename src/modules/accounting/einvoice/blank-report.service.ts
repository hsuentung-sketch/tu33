/**
 * E0402 空白未使用字軌回報 service（Phase E）。
 *
 * 依「電子發票 Turnkey 上線前自行檢測作業 V4.8」項 5(2)：
 *   「空白未使用字軌檔須要在次期 10 號前上傳。」
 *
 * 邏輯：
 *  1. 找出「當期截止、應該回報的期別」— 由 currentReportPeriod() 計算
 *  2. 掃該租戶指定期別所有 pool，若 nextNumber ≤ rangeEnd 表示還有未使用
 *  3. 若該 pool 該 startNumber 尚未在 EinvoiceBlankReport 表登記過 → 產 E0402 XML
 *     寫入 Turnkey inbound + 建立 EinvoiceBlankReport 紀錄（idempotent）
 *
 * 冪等：cron 每次執行都會 skip 已回報過的 range（unique constraint 保護）。
 */

import { prisma } from '../../../shared/prisma.js';
import { logger } from '../../../shared/logger.js';
import { getTenantSettings } from '../../../shared/utils.js';
import { buildE0402 } from './xml-builder.js';
import { buildStorageEnv, putXml } from './turnkey-storage.js';

export interface BlankReportResult {
  tenantId: string;
  companyName: string;
  yearMonth: string;
  reported: number;
  skipped: number;
  errors: number;
}

/**
 * 計算目前應該回報的期別。
 *
 * 例：
 *  - 執行日 3/10 → 應回報 1/2 月期 "YYY0102"
 *  - 執行日 5/10 → 應回報 3/4 月期 "YYY0304"
 *  - 執行日 1/10 → 應回報前一年 11/12 月期
 *
 * 若非期別交界月（1/3/5/7/9/11 月）呼叫，回傳「上一個已結束的雙月期」。
 */
export function currentReportPeriod(now: Date = new Date()): string {
  // Asia/Taipei 當前年月
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const westYear = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);

  // 上一個已結束的雙月期：取「當月 - 2」的期別
  //   3 月執行 → 1-2 月期
  //   5 月執行 → 3-4 月期
  //   1 月執行 → 前一年 11-12 月期
  let targetYearWest = westYear;
  let targetOddMonth = month - 2; // 想要回報的期別的「單月」數字
  if (targetOddMonth <= 0) {
    targetOddMonth += 12;
    targetYearWest -= 1;
  }
  // 確保是奇數月（若當月為偶數會落在偶數，需退到前一個單月）
  if (targetOddMonth % 2 === 0) targetOddMonth -= 1;
  if (targetOddMonth <= 0) {
    targetOddMonth = 11;
    targetYearWest -= 1;
  }
  const targetEvenMonth = targetOddMonth + 1;
  const rocYear = targetYearWest - 1911;
  return `${String(rocYear).padStart(3, '0')}${String(targetOddMonth).padStart(2, '0')}${String(targetEvenMonth).padStart(2, '0')}`;
}

/** 對單一租戶回報指定期別的未使用字軌 */
export async function reportTenantBlankNumbers(
  tenantId: string,
  yearMonth: string,
  createdBy: string = 'cron',
): Promise<BlankReportResult> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const companyName = tenant?.companyName ?? tenantId;
  const result: BlankReportResult = { tenantId, companyName, yearMonth, reported: 0, skipped: 0, errors: 0 };
  if (!tenant) return result;

  const cfg = getTenantSettings(tenant.settings).einvoice;
  if (!cfg.enabled || !cfg.turnkeyInboundDir) {
    logger.info('einvoice blank-report: tenant 未啟用 einvoice 或未設 turnkey 目錄，skip', { tenantId });
    return result;
  }

  const sellerTaxId = tenant.taxId ?? '';
  if (!/^\d{8}$/.test(sellerTaxId)) {
    logger.warn('einvoice blank-report: tenant.taxId 未設定或格式錯誤，skip', { tenantId });
    return result;
  }

  const pools = await prisma.einvoiceNumberPool.findMany({
    where: { tenantId, yearMonth },
    include: { blankReports: { select: { startNumber: true } } },
  });

  const env = buildStorageEnv({
    turnkeyBackend: cfg.turnkeyBackend,
    turnkeyInboundDir: cfg.turnkeyInboundDir,
    turnkeyOutboundDir: cfg.turnkeyOutboundDir,
  });

  for (const pool of pools) {
    if (pool.nextNumber > pool.rangeEnd) {
      // 已用光，無空白可回報
      result.skipped++;
      continue;
    }
    // 若同 pool 同 startNumber 已回報過 → skip（冪等）
    const reportedStarts = new Set(pool.blankReports.map((b) => b.startNumber));
    if (reportedStarts.has(pool.nextNumber)) {
      result.skipped++;
      continue;
    }

    try {
      const xml = buildE0402({
        seller: { identifier: sellerTaxId, name: tenant.companyName },
        yearMonth: pool.yearMonth,
        trackAlpha: pool.trackAlpha,
        startNumber: String(pool.nextNumber).padStart(8, '0'),
        endNumber: String(pool.rangeEnd).padStart(8, '0'),
        reason: '2', // 未使用
      });
      const fakeNo = `BLANK_${pool.trackAlpha}_${pool.yearMonth}`;
      const wrote = await putXml(env, 'E0402', fakeNo, xml);

      await prisma.einvoiceBlankReport.create({
        data: {
          tenantId,
          poolId: pool.id,
          yearMonth: pool.yearMonth,
          trackAlpha: pool.trackAlpha,
          startNumber: pool.nextNumber,
          endNumber: pool.rangeEnd,
          xmlPath: wrote.locator,
          xmlBody: xml,
          createdBy,
        },
      });
      result.reported++;
      logger.info('einvoice blank-report: 已回報', {
        tenantId, poolId: pool.id, yearMonth: pool.yearMonth,
        trackAlpha: pool.trackAlpha, startNumber: pool.nextNumber, endNumber: pool.rangeEnd,
      });
    } catch (err) {
      result.errors++;
      logger.error('einvoice blank-report: 回報失敗', { tenantId, poolId: pool.id, err });
    }
  }

  return result;
}

/** 批次執行所有啟用 einvoice 的租戶 */
export async function reportAllTenantsBlankNumbers(
  yearMonth?: string,
  now: Date = new Date(),
): Promise<BlankReportResult[]> {
  const period = yearMonth ?? currentReportPeriod(now);
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, settings: true },
  });
  const results: BlankReportResult[] = [];
  for (const t of tenants) {
    const cfg = getTenantSettings(t.settings).einvoice;
    if (!cfg.enabled) continue;
    try {
      results.push(await reportTenantBlankNumbers(t.id, period));
    } catch (err) {
      logger.error('einvoice blank-report: tenant crashed', { tenantId: t.id, err });
    }
  }
  return results;
}
