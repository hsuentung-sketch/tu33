import cron from 'node-cron';
import { logger } from '../shared/logger.js';
import * as billingService from '../modules/core/billing/billing.service.js';

/**
 * Daily billing auto-renewal Cron job
 *
 * 每天凌晨 3:00 AM (Asia/Taipei) 執行一次，自動續訂過期的訂閱：
 * - 查找 renewalDate < now 的訂閱
 * - 生成發票
 * - 創建 RENEWAL 事件
 * - 更新下次續訂日期
 */
export async function runDailyBillingAutoRenewal(now: Date = new Date()): Promise<void> {
  logger.info('Starting daily billing auto-renewal job', { timestamp: now.toISOString() });

  try {
    const results = await billingService.autoRenewSubscriptions();

    logger.info('Daily billing auto-renewal completed', {
      renewed: results.renewed,
      failed: results.failed,
      timestamp: now.toISOString(),
    });

    if (results.details.length > 0) {
      logger.info('Auto-renewed subscriptions', { details: results.details });
    }
  } catch (err) {
    logger.error('Daily billing auto-renewal job failed', {
      error: err instanceof Error ? err.message : String(err),
      timestamp: now.toISOString(),
    });
  }
}

/**
 * Schedule the billing auto-renewal at 03:00 Asia/Taipei every day.
 */
export function scheduleDailyBillingAutoRenewal(): void {
  cron.schedule('0 3 * * *', () => {
    runDailyBillingAutoRenewal().catch((err) => {
      logger.error('Daily billing auto-renewal crashed', { error: err });
    });
  }, { timezone: 'Asia/Taipei' });
  logger.info('Daily billing auto-renewal scheduled: daily 03:00 Asia/Taipei');
}
