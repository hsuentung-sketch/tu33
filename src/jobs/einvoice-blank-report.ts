/**
 * E0402 空白未使用字軌回報 cron（Phase E）。
 *
 * 依「電子發票 Turnkey 上線前自行檢測作業 V4.8」項 5(2)：
 *   「空白未使用字軌檔須要在次期 10 號前上傳。」
 *
 * 排程：每雙月 10 號 09:00 (Asia/Taipei)
 *   → 3/10、5/10、7/10、9/10、11/10、隔年 1/10
 *   由 currentReportPeriod() 自動推算應回報的上一期。
 *
 * 冪等：service 內建 unique constraint，重複執行不會產出重複 E0402。
 */
import cron from 'node-cron';
import { logger } from '../shared/logger.js';
import { reportAllTenantsBlankNumbers } from '../modules/accounting/einvoice/blank-report.service.js';

export async function runEinvoiceBlankReport(now: Date = new Date()): Promise<void> {
  try {
    const results = await reportAllTenantsBlankNumbers(undefined, now);
    const totalReported = results.reduce((s, r) => s + r.reported, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors, 0);
    logger.info('einvoice blank-report done', {
      tenants: results.length,
      totalReported,
      totalErrors,
    });
  } catch (err) {
    logger.error('einvoice blank-report failed', { err });
  }
}

/**
 * 排程 cron：`0 9 10 1,3,5,7,9,11 *`
 *   分鐘 0，時 9，日 10，月 1/3/5/7/9/11（單月），星期不限
 */
export function scheduleEinvoiceBlankReport(): void {
  cron.schedule('0 9 10 1,3,5,7,9,11 *', () => { void runEinvoiceBlankReport(); }, { timezone: 'Asia/Taipei' });
  logger.info('einvoice blank-report scheduled (1,3,5,7,9,11 月 10 號 09:00 Asia/Taipei)');
}
