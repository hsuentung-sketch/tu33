import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../shared/prisma.js';
import { requireRole } from '../auth/auth.middleware.js';
import { ValidationError } from '../../../shared/errors.js';
import * as versionService from './version.service.js';

export const versionRouter = Router();

const publishVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本格式必須為 X.Y.Z'),
  features: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
});

const upgradeVersionSchema = z.object({
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/, '版本格式必須為 X.Y.Z'),
});

/**
 * [ADMIN] 發布新版本
 * POST /api/versions
 *
 * 流程：
 * 1. 驗證版本格式 (X.Y.Z)
 * 2. 創建 VersionHistory，supportedUntil = now + 30 days
 * 3. 更新所有租戶的 TenantVersionSubscription.latestVersion
 * 4. 發送 LINE 推播通知
 */
versionRouter.post(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = publishVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const versionRecord = await versionService.publishVersion({
        version: parsed.data.version,
        features: parsed.data.features,
        notes: parsed.data.notes,
      });

      res.status(201).json({
        message: '版本已發布',
        version: versionRecord,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 查詢所有版本
 * GET /api/versions
 *
 * 支援查詢參數：
 * - includeInactive=true: 包含已停用版本
 */
versionRouter.get(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';

      const versions = await prisma.versionHistory.findMany({
        where: {
          ...(includeInactive ? {} : { isActive: true }),
        },
        orderBy: { releaseDate: 'desc' },
      });

      res.json({
        versions,
        count: versions.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 查詢租戶的版本更新狀態
 * GET /api/tenant/updates
 *
 * 返回：
 * {
 *   currentVersion: string,
 *   latestVersion: string,
 *   upgradeDeadline: Date | null,
 *   daysUntilDeadline: number | null,
 *   canUpgrade: boolean,
 *   latestVersionDetails: VersionHistory
 * }
 */
versionRouter.get(
  '/tenant/updates',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updates = await versionService.getTenantUpdates(req.tenantId);
      res.json(updates);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 租戶手動升級版本
 * POST /api/tenant/upgrade
 *
 * 流程：
 * 1. 驗證目標版本存在且活躍
 * 2. 更新 TenantVersionSubscription.currentVersion
 * 3. 清除 upgradeDeadline
 * 4. 發送 LINE 升級完成通知
 */
versionRouter.post(
  '/tenant/upgrade',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = upgradeVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const updated = await versionService.upgradeVersion(req.tenantId, parsed.data.targetVersion);

      res.json({
        message: '版本升級成功',
        subscription: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 租戶版本退回
 * POST /api/tenant/rollback
 *
 * Body: { reason?: string }
 *
 * 限制：
 * - 必須有 previousVersion（升級後才有）
 * - 連續 rollback 不允許
 */
versionRouter.post(
  '/tenant/rollback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

      const updated = await versionService.rollbackVersion(req.tenantId, {
        operatorId: (req as any).employeeId ?? undefined,
        reason,
      });

      res.json({
        message: '版本已退回',
        subscription: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 手動觸發自動升級
 * POST /api/versions/auto-upgrade
 *
 * 通常由 Cron job 呼叫，但可用於手動測試或緊急升級
 *
 * 返回：
 * {
 *   upgraded: number,
 *   failed: number,
 *   details: Array<{ tenantId, fromVersion, toVersion }>
 * }
 */
versionRouter.post(
  '/auto-upgrade',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await versionService.autoUpgradeExpiredVersions();
      res.json({
        message: '自動升級已執行',
        results,
      });
    } catch (err) {
      next(err);
    }
  },
);
