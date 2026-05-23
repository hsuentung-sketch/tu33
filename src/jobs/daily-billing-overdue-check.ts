import cron from 'node-cron';
import { logger } from '../shared/logger.js';
import * as advancedBillingService from '../modules/core/billing/billing-advanced.service.js';

/**
 * Daily billing overdue check Cron job
 *
 * 每天凌晨 4:00 AM (Asia/Taipei) 執行一次，檢查並標記逾期發票：
 * - 查找 ISSUED 30+ 天的發票
 * - 標記為 OVERDUE
 * - 記錄逾期時間
 */
export async function runDailyBillingOverdueCheck(now: Date = new Date()): Promise<void> {
  logger.info('Starting daily billing overdue check job', { timestamp: now.toISOString() });

  try {
    const results = await advancedBillingService.markOverdueInvoices({
      overdueDays: 30,
    });

    logger.info('Daily billing overdue check completed', {
      markedOverdue: results.markedOverdue,
      suspendedTenants: results.suspendedTenants,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    logger.error('Daily billing overdue check job failed', {
      error: err instanceof Error ? err.message : String(err),
      timestamp: now.toISOString(),
    });
  }
}

/**
 * Schedule the overdue check at 04:00 Asia/Taipei every day.
 */
export function scheduleDailyBillingOverdueCheck(): void {
  cron.schedule(
    '0 4 * * *',
    () => {
      runDailyBillingOverdueCheck().catch((err) => {
        logger.error('Daily billing overdue check crashed', { error: err });
      });
    },
    { timezone: 'Asia/Taipei' },
  );
  logger.info('Daily billing overdue check scheduled: daily 04:00 Asia/Taipei');
}
