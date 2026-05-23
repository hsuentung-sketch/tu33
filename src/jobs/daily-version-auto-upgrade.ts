import cron from 'node-cron';
import { logger } from '../shared/logger.js';
import * as versionService from '../modules/core/version/version.service.js';

/**
 * Daily version auto-upgrade Cron job
 *
 * 每天 10:00 AM (Asia/Taipei) 執行一次，自動升級過期的租戶版本：
 * - 查找 upgradeDeadline < now 的租戶
 * - 自動升級到 latestVersion
 * - 發送 LINE 升級完成通知
 */
export async function runDailyVersionAutoUpgrade(now: Date = new Date()): Promise<void> {
  logger.info('Starting daily version auto-upgrade job', { timestamp: now.toISOString() });

  try {
    const results = await versionService.autoUpgradeExpiredVersions();

    logger.info('Daily version auto-upgrade completed', {
      upgraded: results.upgraded,
      failed: results.failed,
      timestamp: now.toISOString(),
    });

    if (results.details.length > 0) {
      logger.info('Auto-upgraded tenants', { details: results.details });
    }
  } catch (err) {
    logger.error('Daily version auto-upgrade job failed', {
      error: err instanceof Error ? err.message : String(err),
      timestamp: now.toISOString(),
    });
  }
}

/**
 * Schedule the version auto-upgrade at 10:00 Asia/Taipei every day.
 */
export function scheduleDailyVersionAutoUpgrade(): void {
  cron.schedule('0 10 * * *', () => {
    runDailyVersionAutoUpgrade().catch((err) => {
      logger.error('Daily version auto-upgrade crashed', { error: err });
    });
  }, { timezone: 'Asia/Taipei' });
  logger.info('Daily version auto-upgrade scheduled: daily 10:00 Asia/Taipei');
}
