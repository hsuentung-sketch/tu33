/**
 * Feature Catalog Service
 *
 * 查詢租戶可用功能、用量檢查、跨租戶功能總覽（platform 用）。
 */
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ForbiddenError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';

// ── 租戶功能查詢 ──────────────────────────────────────

export interface TenantFeatureInfo {
  planName: string;
  planId: string;
  enabledModules: string[];
  disabledModules: string[];
  usageLimits: UsageLimitStatus[];
}

export interface UsageLimitStatus {
  metricType: string;
  limit: number;
  currentUsage: number;
  remaining: number;
  percentUsed: number;
  isExceeded: boolean;
}

/**
 * 查詢租戶的完整功能狀態（可用模組 + 用量狀態）
 */
export async function getTenantFeatures(tenantId: string): Promise<TenantFeatureInfo> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
    select: {
      planId: true,
      plan: {
        select: {
          name: true,
          planFeatures: {
            select: { feature: true, enabled: true },
          },
          usageLimits: {
            select: { metricType: true, monthlyLimit: true },
          },
        },
      },
    },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', tenantId);
  }

  const enabledModules = subscription.plan.planFeatures
    .filter((f) => f.enabled)
    .map((f) => f.feature);

  const disabledModules = subscription.plan.planFeatures
    .filter((f) => !f.enabled)
    .map((f) => f.feature);

  // 查用量
  const usageLimits = await Promise.all(
    subscription.plan.usageLimits.map((ul) =>
      resolveUsageStatus(tenantId, ul.metricType, Number(ul.monthlyLimit)),
    ),
  );

  return {
    planName: subscription.plan.name,
    planId: subscription.planId,
    enabledModules,
    disabledModules,
    usageLimits,
  };
}

// ── 用量檢查 ──────────────────────────────────────────

/**
 * 檢查指定 metricType 是否超額，超額則 throw ForbiddenError。
 * 用於建立資源前（如新增員工、客戶、訂單）。
 */
export async function checkUsageLimit(
  tenantId: string,
  metricType: string,
): Promise<void> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
    select: {
      plan: {
        select: {
          name: true,
          usageLimits: {
            where: { metricType },
            select: { monthlyLimit: true },
          },
        },
      },
    },
  });

  if (!subscription) return; // 無訂閱不擋（由 feature gate 處理）

  const limitRecord = subscription.plan.usageLimits[0];
  if (!limitRecord) return; // 此 metricType 無設限

  const limit = Number(limitRecord.monthlyLimit);
  if (limit < 0) return; // -1 = 無限制

  const currentUsage = await getCurrentUsage(tenantId, metricType);

  if (currentUsage >= limit) {
    logger.info('Usage limit exceeded', {
      tenantId,
      metricType,
      limit,
      currentUsage,
      plan: subscription.plan.name,
    });
    throw new ForbiddenError(
      `已達「${subscription.plan.name}」方案的${metricLabel(metricType)}上限 (${currentUsage}/${limit})，請升級方案`,
    );
  }
}

/**
 * 取得指定 metricType 的目前用量
 */
async function getCurrentUsage(tenantId: string, metricType: string): Promise<number> {
  switch (metricType) {
    case 'employee_count':
      return prisma.employee.count({ where: { tenantId, isActive: true } });

    case 'customer_count':
      return prisma.customer.count({ where: { tenantId } });

    case 'monthly_order_count': {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      return prisma.salesOrder.count({
        where: { tenantId, createdAt: { gte: startOfMonth } },
      });
    }

    case 'monthly_invoice_count': {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      return prisma.invoice.count({
        where: {
          subscription: { tenantId },
          issuedAt: { gte: startOfMonth },
        },
      });
    }

    case 'product_count':
      return prisma.product.count({ where: { tenantId } });

    default:
      logger.warn('Unknown usage metric type', { tenantId, metricType });
      return 0;
  }
}

function metricLabel(metricType: string): string {
  const labels: Record<string, string> = {
    employee_count: '員工數',
    customer_count: '客戶數',
    monthly_order_count: '每月訂單數',
    monthly_invoice_count: '每月發票數',
    product_count: '產品數',
  };
  return labels[metricType] || metricType;
}

async function resolveUsageStatus(
  tenantId: string,
  metricType: string,
  limit: number,
): Promise<UsageLimitStatus> {
  const currentUsage = await getCurrentUsage(tenantId, metricType);
  const effectiveLimit = limit < 0 ? Infinity : limit;
  const remaining = Math.max(0, effectiveLimit - currentUsage);
  const percentUsed = effectiveLimit === Infinity ? 0 : Math.round((currentUsage / effectiveLimit) * 100);

  return {
    metricType,
    limit,
    currentUsage,
    remaining: limit < 0 ? -1 : remaining,
    percentUsed,
    isExceeded: limit >= 0 && currentUsage >= limit,
  };
}

// ── Platform 全租戶功能總覽 ───────────────────────────

export interface PlatformFeatureOverview {
  tenantId: string;
  companyName: string;
  planName: string;
  enabledModules: string[];
  usageLimits: UsageLimitStatus[];
}

/**
 * 全租戶功能狀態（SaaS 主控台用）
 */
export async function getAllTenantsFeatures(): Promise<PlatformFeatureOverview[]> {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      companyName: true,
      billingSubscription: {
        select: {
          plan: {
            select: {
              name: true,
              planFeatures: {
                where: { enabled: true },
                select: { feature: true },
              },
              usageLimits: {
                select: { metricType: true, monthlyLimit: true },
              },
            },
          },
        },
      },
    },
  });

  const results: PlatformFeatureOverview[] = [];

  for (const tenant of tenants) {
    const sub = tenant.billingSubscription;
    const enabledModules = sub?.plan.planFeatures.map((f) => f.feature) ?? [];

    const usageLimits = await Promise.all(
      (sub?.plan.usageLimits ?? []).map((ul) =>
        resolveUsageStatus(tenant.id, ul.metricType, Number(ul.monthlyLimit)),
      ),
    );

    results.push({
      tenantId: tenant.id,
      companyName: tenant.companyName,
      planName: sub?.plan.name ?? '無訂閱',
      enabledModules,
      usageLimits,
    });
  }

  return results;
}
