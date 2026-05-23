/**
 * Feature Gate Middleware
 *
 * 根據租戶訂閱的計畫 (BillingPlan) 的 PlanFeature 來控制模組存取。
 * 用法：
 *   router.use(requireModule('sales'));        // 單一模組
 *   router.use(requireModule('accounting'));    // 會計模組
 *
 * 查詢邏輯：
 *   tenant → billingSubscription → plan → planFeatures
 *   找到 feature === moduleName && enabled === true → 放行
 *   否則 → 403 + 升級提示
 *
 * 快取：每個 tenantId 快取 60 秒，避免每次 request 都查 DB。
 */
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../shared/prisma.js';
import { ForbiddenError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

// ── 快取 ──────────────────────────────────────────────
interface FeatureCache {
  features: Set<string>;
  planName: string;
  expireAt: number;
}

const cache = new Map<string, FeatureCache>();
const CACHE_TTL_MS = 60_000; // 60 秒

function clearCache(tenantId?: string) {
  if (tenantId) {
    cache.delete(tenantId);
  } else {
    cache.clear();
  }
}

/** 供外部呼叫（例如計畫變更後清快取） */
export { clearCache as clearFeatureCache };

async function getEnabledFeatures(tenantId: string): Promise<FeatureCache> {
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && cached.expireAt > now) {
    return cached;
  }

  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
    select: {
      plan: {
        select: {
          name: true,
          planFeatures: {
            where: { enabled: true },
            select: { feature: true },
          },
        },
      },
    },
  });

  // 無訂閱 → 空功能集（全部擋）
  const features = new Set<string>(
    subscription?.plan.planFeatures.map((f) => f.feature) ?? [],
  );
  const planName = subscription?.plan.name ?? '無訂閱';

  const entry: FeatureCache = {
    features,
    planName,
    expireAt: now + CACHE_TTL_MS,
  };
  cache.set(tenantId, entry);
  return entry;
}

/**
 * Middleware factory：要求租戶的計畫包含指定模組。
 *
 * @param moduleName - PlanFeature.feature 名稱（e.g., 'sales', 'accounting'）
 */
export function requireModule(moduleName: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.tenantId) {
        return next(new ForbiddenError('Tenant not identified'));
      }

      const { features, planName } = await getEnabledFeatures(req.tenantId);

      if (!features.has(moduleName)) {
        logger.info('Feature gate blocked', {
          tenantId: req.tenantId,
          module: moduleName,
          plan: planName,
          path: req.originalUrl,
        });
        return next(
          new ForbiddenError(
            `您的方案「${planName}」不包含「${moduleName}」模組，請升級方案以使用此功能`,
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
