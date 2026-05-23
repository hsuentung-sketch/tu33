import type { VersionHistory, TenantVersionSubscription, VersionChangeType } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { getLineClient } from '../../../line/client.js';
import { logger } from '../../../shared/logger.js';

const GRACE_PERIOD_DAYS = 30;

/**
 * 發布新版本
 * - 創建 VersionHistory 記錄，supportedUntil = now + 30 days
 * - 為所有活躍租戶更新 TenantVersionSubscription
 * - 發送 LINE 通知
 */
export async function publishVersion(input: {
  version: string;
  features?: string[];
  notes?: string;
}): Promise<VersionHistory> {
  // 檢查版本是否已存在
  const existing = await prisma.versionHistory.findUnique({
    where: { version: input.version },
  });
  if (existing && existing.isActive) {
    throw new ValidationError(`版本 ${input.version} 已存在`);
  }

  const now = new Date();
  const supportedUntil = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const versionRecord = await prisma.versionHistory.create({
    data: {
      id: `ver_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      version: input.version,
      releaseDate: now,
      supportedUntil,
      features: input.features ?? [],
      notes: input.notes,
      isActive: true,
    },
  });

  // 為所有活躍租戶更新 subscription，設置 latestVersion
  const activeTenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  for (const tenant of activeTenants) {
    const subscription = await prisma.tenantVersionSubscription.findUnique({
      where: { tenantId: tenant.id },
    });

    if (subscription) {
      // 更新為新版本
      await prisma.tenantVersionSubscription.update({
        where: { tenantId: tenant.id },
        data: {
          latestVersion: input.version,
          upgradeDeadline: supportedUntil,
          lastCheckedAt: now,
        },
      });
    } else {
      // 初始化 subscription
      await prisma.tenantVersionSubscription.create({
        data: {
          id: `vs_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          tenantId: tenant.id,
          currentVersion: input.version, // 新租戶直接使用最新版本
          latestVersion: input.version,
          upgradeDeadline: supportedUntil,
          lastCheckedAt: now,
        },
      });
    }

    // 發送通知
    await notifyVersionAvailable(tenant.id, input.version).catch((err) => {
      logger.warn('Failed to notify version available', {
        tenantId: tenant.id,
        version: input.version,
        error: err.message,
      });
    });
  }

  return versionRecord;
}

/**
 * 取得最新的活躍版本
 */
export async function getLatestVersion(): Promise<VersionHistory | null> {
  return prisma.versionHistory.findFirst({
    where: { isActive: true },
    orderBy: { releaseDate: 'desc' },
  });
}

/**
 * 取得租戶的版本更新狀態
 */
export async function getTenantUpdates(tenantId: string): Promise<{
  currentVersion: string;
  latestVersion: string;
  upgradeDeadline: Date | null;
  daysUntilDeadline: number | null;
  canUpgrade: boolean;
  latestVersionDetails: VersionHistory | null;
}> {
  const subscription = await prisma.tenantVersionSubscription.findUnique({
    where: { tenantId },
  });

  if (!subscription) {
    throw new NotFoundError('TenantVersionSubscription', tenantId);
  }

  const latestVersionDetails = await prisma.versionHistory.findUnique({
    where: { version: subscription.latestVersion },
  });

  const now = new Date();
  const daysUntilDeadline = subscription.upgradeDeadline
    ? Math.ceil((subscription.upgradeDeadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const canUpgrade = subscription.currentVersion !== subscription.latestVersion;

  return {
    currentVersion: subscription.currentVersion,
    latestVersion: subscription.latestVersion,
    upgradeDeadline: subscription.upgradeDeadline,
    daysUntilDeadline,
    canUpgrade,
    latestVersionDetails,
  };
}

/**
 * 租戶手動升級版本
 */
export async function upgradeVersion(
  tenantId: string,
  targetVersion: string,
  opts?: { operatorId?: string; changeType?: VersionChangeType },
): Promise<TenantVersionSubscription> {
  const subscription = await prisma.tenantVersionSubscription.findUnique({
    where: { tenantId },
  });

  if (!subscription) {
    throw new NotFoundError('TenantVersionSubscription', tenantId);
  }

  // 驗證目標版本是否存在且活躍
  const targetVersionRecord = await prisma.versionHistory.findUnique({
    where: { version: targetVersion },
  });

  if (!targetVersionRecord || !targetVersionRecord.isActive) {
    throw new ValidationError(`版本 ${targetVersion} 不存在或已停用`);
  }

  const now = new Date();
  const fromVersion = subscription.currentVersion;
  const changeType = opts?.changeType ?? 'UPGRADE';

  // 交易：同時更新 subscription + 寫入升級 log
  const [updated] = await prisma.$transaction([
    prisma.tenantVersionSubscription.update({
      where: { tenantId },
      data: {
        currentVersion: targetVersion,
        previousVersion: fromVersion,
        lastUpgradedAt: now,
        upgradeDeadline: null,
      },
    }),
    prisma.versionUpgradeLog.create({
      data: {
        tenantId,
        fromVersion,
        toVersion: targetVersion,
        changeType,
        operatorId: opts?.operatorId ?? null,
      },
    }),
  ]);

  // 發送升級完成通知
  await notifyVersionUpgradeCompleted(tenantId, targetVersion).catch((err) => {
    logger.warn('Failed to notify version upgrade completed', {
      tenantId,
      version: targetVersion,
      error: err.message,
    });
  });

  return updated;
}

/**
 * 租戶版本退回（rollback 到 previousVersion）
 *
 * 限制：
 * - 必須有 previousVersion
 * - previousVersion 對應的 VersionHistory 必須存在且 isActive
 * - 連續 rollback 不允許（rollback 後 previousVersion 設為 null）
 */
export async function rollbackVersion(
  tenantId: string,
  opts?: { operatorId?: string; reason?: string },
): Promise<TenantVersionSubscription> {
  const subscription = await prisma.tenantVersionSubscription.findUnique({
    where: { tenantId },
  });

  if (!subscription) {
    throw new NotFoundError('TenantVersionSubscription', tenantId);
  }

  if (!subscription.previousVersion) {
    throw new ValidationError('無可退回版本（previousVersion 為空，可能已經退回過）');
  }

  // 驗證舊版本仍可用
  const prevVersionRecord = await prisma.versionHistory.findUnique({
    where: { version: subscription.previousVersion },
  });

  if (!prevVersionRecord || !prevVersionRecord.isActive) {
    throw new ValidationError(`舊版本 ${subscription.previousVersion} 已停用，無法退回`);
  }

  const now = new Date();
  const fromVersion = subscription.currentVersion;
  const toVersion = subscription.previousVersion;

  const [updated] = await prisma.$transaction([
    prisma.tenantVersionSubscription.update({
      where: { tenantId },
      data: {
        currentVersion: toVersion,
        previousVersion: null, // 防止連續 rollback
        lastUpgradedAt: now,
      },
    }),
    prisma.versionUpgradeLog.create({
      data: {
        tenantId,
        fromVersion,
        toVersion,
        changeType: 'ROLLBACK',
        operatorId: opts?.operatorId ?? null,
        reason: opts?.reason ?? null,
      },
    }),
  ]);

  logger.info('Version rolled back', { tenantId, fromVersion, toVersion });

  return updated;
}

/**
 * 自動升級過期的租戶版本（Cron job handler）
 * - 查找 upgradeDeadline < now 的租戶
 * - 自動升級到 latestVersion
 */
export async function autoUpgradeExpiredVersions(): Promise<{
  upgraded: number;
  failed: number;
  details: Array<{ tenantId: string; fromVersion: string; toVersion: string }>;
}> {
  const now = new Date();

  // 查找需要升級的租戶
  const expiredSubscriptions = await prisma.tenantVersionSubscription.findMany({
    where: {
      upgradeDeadline: { lte: now },
      currentVersion: { not: { equals: '' } }, // 有當前版本
    },
  });

  const results = {
    upgraded: 0,
    failed: 0,
    details: [] as Array<{ tenantId: string; fromVersion: string; toVersion: string }>,
  };

  for (const subscription of expiredSubscriptions) {
    try {
      // 檢查是否已經升級到最新版本
      if (subscription.currentVersion === subscription.latestVersion) {
        continue;
      }

      await upgradeVersion(subscription.tenantId, subscription.latestVersion, {
        changeType: 'AUTO_UPGRADE',
      });
      results.upgraded++;
      results.details.push({
        tenantId: subscription.tenantId,
        fromVersion: subscription.currentVersion,
        toVersion: subscription.latestVersion,
      });

      logger.info('Auto-upgraded tenant version', {
        tenantId: subscription.tenantId,
        fromVersion: subscription.currentVersion,
        toVersion: subscription.latestVersion,
      });
    } catch (err) {
      results.failed++;
      logger.error('Failed to auto-upgrade tenant version', {
        tenantId: subscription.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * 發送版本可用通知（LINE message）
 */
async function notifyVersionAvailable(tenantId: string, version: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { lineAccessToken: true, companyName: true },
  });

  if (!tenant || !tenant.lineAccessToken) {
    logger.debug('Tenant not configured for LINE notifications', { tenantId });
    return;
  }

  const versionDetails = await prisma.versionHistory.findUnique({
    where: { version },
    select: { features: true, notes: true, supportedUntil: true },
  });

  try {
    const client = getLineClient(tenant.lineAccessToken);
    const message = {
      type: 'text' as const,
      text: `🔔 ERP 新版本發布: v${version}\n\n` +
            (versionDetails?.notes ? `📝 ${versionDetails.notes}\n\n` : '') +
            (versionDetails?.features && versionDetails.features.length > 0
              ? `✨ 新功能:\n${versionDetails.features.map((f) => `• ${f}`).join('\n')}\n\n`
              : '') +
            `⏰ 寬限期至: ${versionDetails?.supportedUntil ? versionDetails.supportedUntil.toLocaleDateString('zh-TW') : 'N/A'}\n` +
            `👉 請於期限內升級版本`,
    };

    // 推播給租戶所有活躍員工
    const employees = await prisma.employee.findMany({
      where: { tenantId, isActive: true, lineUserId: { not: null } },
      select: { lineUserId: true },
    });

    for (const emp of employees) {
      if (emp.lineUserId) {
        try {
          await client.pushMessage({ to: emp.lineUserId, messages: [message] });
        } catch (err) {
          logger.warn('Failed to push version notification to employee', {
            tenantId,
            employeeLineUserId: emp.lineUserId?.slice(0, 8) + '...',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    throw new Error(`Failed to notify version available: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 發送版本升級完成通知（LINE message）
 */
async function notifyVersionUpgradeCompleted(tenantId: string, version: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { lineAccessToken: true, companyName: true },
  });

  if (!tenant || !tenant.lineAccessToken) {
    logger.debug('Tenant not configured for LINE notifications', { tenantId });
    return;
  }

  try {
    const client = getLineClient(tenant.lineAccessToken);
    const message = {
      type: 'text' as const,
      text: `✅ ERP 版本升級成功\n\n` +
            `🎉 已升級至 v${version}\n` +
            `感謝您的配合！系統將以最新功能繼續服務。`,
    };

    // 推播給租戶所有活躍員工
    const employees = await prisma.employee.findMany({
      where: { tenantId, isActive: true, lineUserId: { not: null } },
      select: { lineUserId: true },
    });

    for (const emp of employees) {
      if (emp.lineUserId) {
        try {
          await client.pushMessage({ to: emp.lineUserId, messages: [message] });
        } catch (err) {
          logger.warn('Failed to push upgrade notification to employee', {
            tenantId,
            employeeLineUserId: emp.lineUserId?.slice(0, 8) + '...',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    throw new Error(`Failed to notify version upgrade completed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
