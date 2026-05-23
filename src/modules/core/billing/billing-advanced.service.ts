/**
 * Advanced Billing Features (P0-3c)
 * - 年繳優惠 + 首次設計價格
 * - 逾期發票管理
 * - 訂閱暫停/恢復（ADMIN 限制）
 * - 使用量計費
 */

import type {
  TenantBillingSubscription,
  Invoice,
  UsageMetric,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';

// ============================================================
// 1. 年繳優惠 + 首次設計價格
// ============================================================

/**
 * 計算首次訂閱總費用（首次設計費 + 首月費用）
 */
export async function calculateInitialSubscriptionCost(input: {
  planId: string;
  billingCycle: 'MONTHLY' | 'ANNUALLY';
}): Promise<{ setupFee: number; billingFee: number; total: number }> {
  const plan = await prisma.billingPlan.findUnique({
    where: { id: input.planId },
  });

  if (!plan) {
    throw new NotFoundError('BillingPlan', input.planId);
  }

  const setupFee = parseFloat(plan.initialSetupPrice.toString());
  const billingFee =
    input.billingCycle === 'MONTHLY'
      ? parseFloat(plan.monthlyPrice.toString())
      : calculateYearlyPrice(plan);

  return {
    setupFee,
    billingFee,
    total: setupFee + billingFee,
  };
}

/**
 * 計算年繳價格（含折扣）
 */
function calculateYearlyPrice(plan: any): number {
  const baseYearly = parseFloat(plan.monthlyPrice.toString()) * 12;
  const discountPercent = parseFloat(plan.yearlyDiscountPercent.toString());
  const discount = baseYearly * (discountPercent / 100);
  return baseYearly - discount;
}

/**
 * 更新計畫的年繳價格（管理員設定）
 */
export async function updatePlanYearlyPricing(input: {
  planId: string;
  initialSetupPrice?: number;
  monthlyPrice?: number;
  yearlyDiscountPercent?: number;
}): Promise<any> {
  const plan = await prisma.billingPlan.findUnique({
    where: { id: input.planId },
  });

  if (!plan) {
    throw new NotFoundError('BillingPlan', input.planId);
  }

  const updated = await prisma.billingPlan.update({
    where: { id: input.planId },
    data: {
      initialSetupPrice: input.initialSetupPrice !== undefined ? input.initialSetupPrice : undefined,
      monthlyPrice: input.monthlyPrice !== undefined ? input.monthlyPrice : undefined,
      yearlyDiscountPercent:
        input.yearlyDiscountPercent !== undefined ? input.yearlyDiscountPercent : undefined,
    },
  });

  logger.info('Plan yearly pricing updated', {
    planId: input.planId,
    setupPrice: input.initialSetupPrice,
    monthlyPrice: input.monthlyPrice,
    yearlyDiscount: input.yearlyDiscountPercent,
  });

  return updated;
}

// ============================================================
// 2. 逾期發票管理
// ============================================================

/**
 * 檢查並標記逾期發票（Cron job handler）
 * - ISSUED 30 天後自動標記為 OVERDUE
 * - 可選：暫停相關租戶服務
 */
export async function markOverdueInvoices(input: { overdueDays?: number } = {}): Promise<{
  markedOverdue: number;
  suspendedTenants: number;
}> {
  const overdueDays = input.overdueDays || 30;
  const now = new Date();
  const overdueThreshold = new Date(now.getTime() - overdueDays * 24 * 60 * 60 * 1000);

  // 查找逾期發票
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: 'ISSUED',
      dueDate: { lte: overdueThreshold },
    },
  });

  const results = {
    markedOverdue: 0,
    suspendedTenants: 0,
  };

  for (const invoice of overdueInvoices) {
    try {
      // 標記為逾期
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'OVERDUE',
          overdueSince: now,
        },
      });

      // 創建逾期事件
      const subscription = await prisma.tenantBillingSubscription.findUnique({
        where: { id: invoice.subscriptionId },
      });

      if (subscription) {
        await prisma.billingEvent.create({
          data: {
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            subscriptionId: subscription.id,
            eventType: 'OVERDUE_NOTICE',
            description: `發票逾期：${invoice.invoiceNumber}`,
          },
        });
      }

      results.markedOverdue++;

      logger.info('Invoice marked as overdue', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });
    } catch (err) {
      logger.error('Failed to mark invoice as overdue', {
        invoiceId: invoice.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * 發送逾期催款通知（可選，實際發送由 LINE / Email 負責）
 */
export async function recordOverdueReminder(invoiceId: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  if (invoice.status !== 'OVERDUE') {
    throw new ValidationError('發票未逾期，無需催款');
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      reminderSentAt: new Date(),
    },
  });

  logger.info('Overdue reminder recorded', { invoiceId });

  return updated;
}

// ============================================================
// 3. 訂閱暫停/恢復（ADMIN 限制）
// ============================================================

/**
 * SAAS 主控台暫停租戶訂閱
 * - 設置 suspendedAt、suspendedUntil、suspendReason
 * - 創建 SUSPENSION 事件
 * - 後續不生成發票、不扣費
 */
export async function suspendSubscription(input: {
  tenantId: string;
  reason: string;
  suspendUntil?: Date; // 可選：指定恢復日期
}): Promise<TenantBillingSubscription> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId: input.tenantId },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', input.tenantId);
  }

  if (subscription.suspendedAt) {
    throw new ValidationError('訂閱已暫停');
  }

  const now = new Date();
  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId: input.tenantId },
    data: {
      suspendedAt: now,
      suspendedUntil: input.suspendUntil || null,
      suspendReason: input.reason,
    },
  });

  // 創建暫停事件
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: subscription.id,
      eventType: 'SUSPENSION',
      description: `訂閱暫停：${input.reason}`,
    },
  });

  logger.info('Subscription suspended', {
    tenantId: input.tenantId,
    reason: input.reason,
    suspendUntil: input.suspendUntil?.toISOString(),
  });

  return updated;
}

/**
 * SAAS 主控台恢復租戶訂閱
 * - 清除 suspendedAt、suspendedUntil、suspendReason
 * - 按暫停天數按比例補收費用
 * - 創建 RESUME 事件
 */
export async function resumeSubscription(tenantId: string): Promise<{
  subscription: TenantBillingSubscription;
  proratedFee: number;
}> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', tenantId);
  }

  if (!subscription.suspendedAt) {
    throw new ValidationError('訂閱未暫停');
  }

  const now = new Date();
  const suspendedDays = Math.ceil((now.getTime() - subscription.suspendedAt.getTime()) / (24 * 60 * 60 * 1000));

  // 計算按比例費用
  const dailyRate =
    subscription.billingCycle === 'MONTHLY'
      ? parseFloat(subscription.plan.monthlyPrice.toString()) / 30
      : parseFloat(subscription.plan.annualPrice.toString()) / 365;

  const proratedFee = suspendedDays * dailyRate;

  // 更新訂閱
  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId },
    data: {
      suspendedAt: null,
      suspendedUntil: null,
      suspendReason: null,
    },
  });

  // 創建恢復事件
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: subscription.id,
      eventType: 'RESUME',
      proratedAmount: new Prisma.Decimal(Math.round(proratedFee * 100) / 100),
      description: `訂閱恢復，按比例補費：$${proratedFee.toFixed(2)}（${suspendedDays} 天）`,
    },
  });

  logger.info('Subscription resumed', {
    tenantId,
    suspendedDays,
    proratedFee,
  });

  return {
    subscription: updated,
    proratedFee: Math.round(proratedFee * 100) / 100,
  };
}

// ============================================================
// 4. 使用量計費
// ============================================================

/**
 * 記錄租戶的使用量指標
 */
export async function trackUsage(input: {
  subscriptionId: string;
  metricType: string; // e.g., "api_calls", "storage_gb", "user_count"
  value: number;
}): Promise<UsageMetric> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { id: input.subscriptionId },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', input.subscriptionId);
  }

  const metric = await prisma.usageMetric.create({
    data: {
      id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: input.subscriptionId,
      metricType: input.metricType,
      value: new Prisma.Decimal(input.value),
    },
  });

  logger.debug('Usage tracked', {
    subscriptionId: input.subscriptionId,
    metricType: input.metricType,
    value: input.value,
  });

  return metric;
}

/**
 * 計算本月使用量與超額費用
 */
export async function calculateMonthlyUsageOverage(input: {
  subscriptionId: string;
  billingMonth: Date; // YYYY-MM 的日期
}): Promise<{
  metrics: Array<{ type: string; used: number; limit: number; overage: number; fee: number }>;
  totalOverageFee: number;
}> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', input.subscriptionId);
  }

  // 獲取本月使用量限制和費率
  const limits = await prisma.usageLimit.findMany({
    where: { planId: subscription.planId },
  });

  const rates = await prisma.usageOverageRate.findMany({
    where: { planId: subscription.planId },
  });

  const rateMap = new Map(rates.map((r) => [r.metricType, r.ratePerUnit]));

  const metrics: Array<{ type: string; used: number; limit: number; overage: number; fee: number }> = [];
  let totalOverageFee = 0;

  // 計算每個指標的使用量和超額
  for (const limit of limits) {
    const monthStart = new Date(input.billingMonth.getFullYear(), input.billingMonth.getMonth(), 1);
    const monthEnd = new Date(input.billingMonth.getFullYear(), input.billingMonth.getMonth() + 1, 1);

    const usageRecords = await prisma.usageMetric.findMany({
      where: {
        subscriptionId: input.subscriptionId,
        metricType: limit.metricType,
        recordedAt: { gte: monthStart, lt: monthEnd },
      },
    });

    const totalUsed = usageRecords.reduce((sum, r) => sum + parseFloat(r.value.toString()), 0);
    const limitValue = parseFloat(limit.monthlyLimit.toString());
    const overage = Math.max(0, totalUsed - limitValue);

    const ratePerUnit = rateMap.get(limit.metricType);
    const overageFee = overage * (ratePerUnit ? parseFloat(ratePerUnit.toString()) : 0);

    metrics.push({
      type: limit.metricType,
      used: totalUsed,
      limit: limitValue,
      overage,
      fee: Math.round(overageFee * 100) / 100,
    });

    totalOverageFee += overageFee;
  }

  return {
    metrics,
    totalOverageFee: Math.round(totalOverageFee * 100) / 100,
  };
}

/**
 * 設定計畫的使用量限制
 */
export async function setUsageLimit(input: {
  planId: string;
  metricType: string;
  monthlyLimit: number;
}): Promise<any> {
  const plan = await prisma.billingPlan.findUnique({
    where: { id: input.planId },
  });

  if (!plan) {
    throw new NotFoundError('BillingPlan', input.planId);
  }

  const limit = await prisma.usageLimit.upsert({
    where: { planId_metricType: { planId: input.planId, metricType: input.metricType } },
    update: {
      monthlyLimit: new Prisma.Decimal(input.monthlyLimit),
    },
    create: {
      id: `limit_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      planId: input.planId,
      metricType: input.metricType,
      monthlyLimit: new Prisma.Decimal(input.monthlyLimit),
    },
  });

  logger.info('Usage limit set', {
    planId: input.planId,
    metricType: input.metricType,
    monthlyLimit: input.monthlyLimit,
  });

  return limit;
}

/**
 * 設定計畫的超額費率
 */
export async function setUsageOverageRate(input: {
  planId: string;
  metricType: string;
  ratePerUnit: number;
}): Promise<any> {
  const plan = await prisma.billingPlan.findUnique({
    where: { id: input.planId },
  });

  if (!plan) {
    throw new NotFoundError('BillingPlan', input.planId);
  }

  const rate = await prisma.usageOverageRate.upsert({
    where: { planId_metricType: { planId: input.planId, metricType: input.metricType } },
    update: {
      ratePerUnit: new Prisma.Decimal(input.ratePerUnit),
    },
    create: {
      id: `rate_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      planId: input.planId,
      metricType: input.metricType,
      ratePerUnit: new Prisma.Decimal(input.ratePerUnit),
    },
  });

  logger.info('Usage overage rate set', {
    planId: input.planId,
    metricType: input.metricType,
    ratePerUnit: input.ratePerUnit,
  });

  return rate;
}
