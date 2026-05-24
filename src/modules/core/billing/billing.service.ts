import type {
  BillingPlan,
  TenantBillingSubscription,
  BillingEvent,
  Invoice,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';

const INVOICE_DUE_DAYS = 30; // 發票期限（30 天）

/**
 * 創建租戶計費訂閱
 * - 初始化試用期（14 天或 Plan 自訂天數）
 * - 創建 SUBSCRIPTION_CREATED 事件
 */
export async function createSubscription(input: {
  tenantId: string;
  planId: string;
  billingCycle: 'MONTHLY' | 'ANNUALLY';
}): Promise<TenantBillingSubscription> {
  // 驗證 Plan 存在且活躍
  const plan = await prisma.billingPlan.findUnique({
    where: { id: input.planId },
  });

  if (!plan || !plan.isActive) {
    throw new ValidationError('計費方案不存在或已停用');
  }

  const now = new Date();
  const trialEndDate = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);

  // 確定續訂日期
  const renewalDate = new Date(trialEndDate);

  const subscription = await prisma.tenantBillingSubscription.create({
    data: {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      tenantId: input.tenantId,
      planId: input.planId,
      billingCycle: input.billingCycle,
      isInTrial: true,
      trialEndDate,
      subscriptionStart: now,
      renewalDate,
    },
  });

  // 創建訂閱事件
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: subscription.id,
      eventType: 'SUBSCRIPTION_CREATED',
      description: `試用期 ${plan.trialDays} 天：${plan.name}`,
    },
  });

  logger.info('Subscription created', {
    tenantId: input.tenantId,
    planId: input.planId,
    trialEndDate: trialEndDate.toISOString(),
  });

  return subscription;
}

/**
 * 取得租戶的計費訂閱狀態
 */
export async function getSubscription(
  tenantId: string,
): Promise<TenantBillingSubscription & { plan: BillingPlan }> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', tenantId);
  }

  return subscription;
}

/**
 * 升級/降級 Plan
 * - 創建 PLAN_UPGRADE / PLAN_DOWNGRADE 事件
 * - 計算按比例退款/補充
 * - 更新 renewalDate
 */
export async function changePlan(input: {
  tenantId: string;
  newPlanId: string;
  effectiveDate?: Date;
}): Promise<{ subscription: TenantBillingSubscription; proratedAmount: number }> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId: input.tenantId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', input.tenantId);
  }

  const newPlan = await prisma.billingPlan.findUnique({
    where: { id: input.newPlanId },
  });

  if (!newPlan || !newPlan.isActive) {
    throw new ValidationError('新計費方案不存在或已停用');
  }

  if (subscription.planId === input.newPlanId) {
    throw new ValidationError('新方案與當前方案相同');
  }

  const effectiveDate = input.effectiveDate || new Date();
  const oldPlan = subscription.plan;

  // 計算按比例金額（簡單實現：基於剩餘天數）
  const now = new Date();
  const renewalDate = subscription.renewalDate;
  const totalDaysInCycle = Math.ceil(
    (renewalDate.getTime() - subscription.subscriptionStart.getTime()) / (24 * 60 * 60 * 1000),
  );
  const remainingDays = Math.ceil(
    (renewalDate.getTime() - effectiveDate.getTime()) / (24 * 60 * 60 * 1000),
  );

  const dailyOldRate =
    subscription.billingCycle === 'MONTHLY'
      ? Number(oldPlan.monthlyPrice) / 30
      : Number(oldPlan.annualPrice) / 365;
  const dailyNewRate =
    subscription.billingCycle === 'MONTHLY'
      ? Number(newPlan.monthlyPrice) / 30
      : Number(newPlan.annualPrice) / 365;

  const usedDays = totalDaysInCycle - remainingDays;
  const oldChargeUsed = dailyOldRate * usedDays;
  const newChargeTotal =
    subscription.billingCycle === 'MONTHLY' ? Number(newPlan.monthlyPrice) : Number(newPlan.annualPrice);
  const proratedAmount = newChargeTotal - oldChargeUsed; // 正數 = 補充，負數 = 退款

  // 更新訂閱
  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId: input.tenantId },
    data: { planId: input.newPlanId },
  });

  // 創建事件
  const eventType = newPlan.monthlyPrice > oldPlan.monthlyPrice ? 'PLAN_UPGRADE' : 'PLAN_DOWNGRADE';
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: subscription.id,
      eventType,
      oldPlanId: subscription.planId,
      newPlanId: input.newPlanId,
      effectiveDate,
      proratedAmount: new Prisma.Decimal(Math.round(proratedAmount * 100) / 100),
      description: `${oldPlan.name} → ${newPlan.name}（按比例：$${Math.abs(proratedAmount).toFixed(2)}）`,
    },
  });

  logger.info('Plan changed', {
    tenantId: input.tenantId,
    oldPlan: oldPlan.name,
    newPlan: newPlan.name,
    proratedAmount,
  });

  return { subscription: updated, proratedAmount };
}

/**
 * 結束試用期，轉換為付費訂閱
 */
export async function endTrial(tenantId: string): Promise<TenantBillingSubscription> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', tenantId);
  }

  if (!subscription.isInTrial) {
    throw new ValidationError('訂閱不在試用期');
  }

  const now = new Date();
  const plan = subscription.plan;

  // 計算下次續訂日期（從試用結束後開始計算）
  const renewalDate =
    subscription.billingCycle === 'MONTHLY'
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId },
    data: {
      isInTrial: false,
      trialEndDate: null,
      renewalDate,
    },
  });

  // 創建事件
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: subscription.id,
      eventType: 'TRIAL_END',
      description: `試用期結束，轉換為付費訂閱（${plan.name}）`,
    },
  });

  logger.info('Trial ended', { tenantId, plan: plan.name });

  return updated;
}

/**
 * 取消訂閱
 */
export async function cancelSubscription(tenantId: string): Promise<TenantBillingSubscription> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { tenantId },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', tenantId);
  }

  if (subscription.cancellationDate) {
    throw new ValidationError('訂閱已取消');
  }

  const now = new Date();
  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId },
    data: {
      autoRenew: false,
      cancellationDate: now,
    },
  });

  // 創建事件
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: subscription.id,
      eventType: 'CANCELLATION',
      description: '租戶取消訂閱',
    },
  });

  logger.info('Subscription cancelled', { tenantId });

  return updated;
}

/**
 * 生成發票
 * - 檢查是否已有該計費期間的發票
 * - 計算金額（考慮折扣、稅金）
 * - 設置發票為 ISSUED 狀態
 */
export async function generateInvoice(input: {
  subscriptionId: string;
  billingPeriodStart: Date;
  discount?: number; // 折扣金額
  notes?: string;
}): Promise<Invoice> {
  const subscription = await prisma.tenantBillingSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundError('TenantBillingSubscription', input.subscriptionId);
  }

  // 檢查是否已有該期間的發票
  const existing = await prisma.invoice.findUnique({
    where: {
      subscriptionId_billingPeriodStart: {
        subscriptionId: input.subscriptionId,
        billingPeriodStart: input.billingPeriodStart,
      },
    },
  });

  if (existing) {
    throw new ValidationError('該計費期間已有發票');
  }

  const amount =
    subscription.billingCycle === 'MONTHLY'
      ? subscription.plan.monthlyPrice
      : subscription.plan.annualPrice;

  const discount = input.discount || 0;
  const tax = 0; // 簡化實現，實際應根據區域計算稅金
  const total = Math.max(0, Number(amount) - Number(discount) + Number(tax));

  // 計費期間結束日期
  const billingPeriodEnd =
    subscription.billingCycle === 'MONTHLY'
      ? new Date(input.billingPeriodStart.getTime() + 30 * 24 * 60 * 60 * 1000)
      : new Date(input.billingPeriodStart.getTime() + 365 * 24 * 60 * 60 * 1000);

  // 發票期限
  const dueDate = new Date(input.billingPeriodStart.getTime() + INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000);

  // 生成發票號
  const invoiceNumber = `INV-${subscription.tenantId.slice(0, 8).toUpperCase()}-${Date.now()}`;

  const invoice = await prisma.invoice.create({
    data: {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      invoiceNumber,
      subscriptionId: input.subscriptionId,
      billingPeriodStart: input.billingPeriodStart,
      billingPeriodEnd,
      amount: new Prisma.Decimal(amount),
      discount: new Prisma.Decimal(discount),
      tax: new Prisma.Decimal(tax),
      total: new Prisma.Decimal(total),
      status: 'ISSUED',
      issuedAt: new Date(),
      dueDate,
      notes: input.notes,
    },
  });

  logger.info('Invoice generated', {
    subscriptionId: input.subscriptionId,
    invoiceNumber,
    amount,
    total,
  });

  return invoice;
}

/**
 * 記錄付款
 */
export async function recordPayment(invoiceId: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  if (invoice.paidAt) {
    throw new ValidationError('發票已付款');
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'PAID',
      paidAt: new Date(),
    },
  });

  logger.info('Payment recorded', { invoiceId });

  return updated;
}

/**
 * 自動續訂過期訂閱（Cron job handler）
 * - 查找 renewalDate < now 且 autoRenew = true 的訂閱
 * - 為每個訂閱生成發票
 * - 創建 RENEWAL 事件
 */
export async function autoRenewSubscriptions(): Promise<{
  renewed: number;
  failed: number;
  details: Array<{ subscriptionId: string; invoiceNumber: string }>;
}> {
  const now = new Date();

  // 查找需要續訂的訂閱
  const expiredSubscriptions = await prisma.tenantBillingSubscription.findMany({
    where: {
      renewalDate: { lte: now },
      autoRenew: true,
      cancellationDate: null,
    },
  });

  const results = {
    renewed: 0,
    failed: 0,
    details: [] as Array<{ subscriptionId: string; invoiceNumber: string }>,
  };

  for (const subscription of expiredSubscriptions) {
    try {
      // 生成發票
      const invoice = await generateInvoice({
        subscriptionId: subscription.id,
        billingPeriodStart: subscription.renewalDate,
      });

      // 更新下次續訂日期
      const nextRenewal =
        subscription.billingCycle === 'MONTHLY'
          ? new Date(subscription.renewalDate.getTime() + 30 * 24 * 60 * 60 * 1000)
          : new Date(subscription.renewalDate.getTime() + 365 * 24 * 60 * 60 * 1000);

      await prisma.tenantBillingSubscription.update({
        where: { id: subscription.id },
        data: { renewalDate: nextRenewal },
      });

      // 創建續訂事件
      await prisma.billingEvent.create({
        data: {
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          subscriptionId: subscription.id,
          eventType: 'RENEWAL',
          description: `自動續訂，發票：${invoice.invoiceNumber}`,
        },
      });

      results.renewed++;
      results.details.push({
        subscriptionId: subscription.id,
        invoiceNumber: invoice.invoiceNumber,
      });

      logger.info('Subscription auto-renewed', {
        subscriptionId: subscription.id,
        invoiceNumber: invoice.invoiceNumber,
      });
    } catch (err) {
      results.failed++;
      logger.error('Failed to auto-renew subscription', {
        subscriptionId: subscription.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * 取得所有可用計費方案
 */
export async function getAllPlans(): Promise<BillingPlan[]> {
  return prisma.billingPlan.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
  });
}

/**
 * 取得 Plan 的功能列表
 */
export async function getPlanFeatures(planId: string): Promise<string[]> {
  const features = await prisma.planFeature.findMany({
    where: { planId, enabled: true },
    select: { feature: true },
  });

  return features.map((f) => f.feature);
}

// ── P0-3a: External sync（供 CP 控制台呼叫，ERP 為 billing single source of truth）──

/**
 * Upsert BillingPlan（by unique name）+ 重設 planFeatures = modules。
 * CP 新建/更新方案時推送過來。modules 為合法 module key（見 docs/module-keys.md）。
 */
export async function upsertPlanFromExternal(input: {
  name: string;
  monthlyPrice: number;
  annualPrice?: number;
  trialDays?: number;
  modules: string[];
  isActive?: boolean;
}): Promise<BillingPlan> {
  if (!input.name?.trim()) throw new ValidationError('方案名稱必填');
  const plan = await prisma.billingPlan.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      monthlyPrice: input.monthlyPrice,
      annualPrice: input.annualPrice ?? input.monthlyPrice * 12,
      trialDays: input.trialDays ?? 14,
      isActive: input.isActive ?? true,
    },
    update: {
      monthlyPrice: input.monthlyPrice,
      ...(input.annualPrice != null ? { annualPrice: input.annualPrice } : {}),
      ...(input.trialDays != null ? { trialDays: input.trialDays } : {}),
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
    },
  });
  // 重設 planFeatures（modules → enabled feature），確保與 CP 一致
  await prisma.planFeature.deleteMany({ where: { planId: plan.id } });
  if (input.modules?.length) {
    await prisma.planFeature.createMany({
      data: input.modules.map((m) => ({ planId: plan.id, feature: m, enabled: true })),
    });
  }
  logger.info('Plan upserted from external (CP)', { name: plan.id, modules: input.modules });
  return plan;
}

/** 暫停訂閱（CP suspend 呼叫）：設 suspendedAt + SUSPENSION 事件。 */
export async function suspendSubscription(
  tenantId: string,
  reason?: string,
  until?: Date,
): Promise<TenantBillingSubscription> {
  const sub = await prisma.tenantBillingSubscription.findUnique({ where: { tenantId } });
  if (!sub) throw new NotFoundError('TenantBillingSubscription', tenantId);
  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId },
    data: { suspendedAt: new Date(), suspendedUntil: until ?? null, suspendReason: reason ?? null },
  });
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: sub.id,
      eventType: 'SUSPENSION',
      description: reason ?? '訂閱暫停（CP）',
    },
  });
  logger.info('Subscription suspended', { tenantId, reason });
  return updated;
}

/** 恢復訂閱（CP resume 呼叫）：清 suspendedAt + RESUME 事件。 */
export async function resumeSubscription(tenantId: string): Promise<TenantBillingSubscription> {
  const sub = await prisma.tenantBillingSubscription.findUnique({ where: { tenantId } });
  if (!sub) throw new NotFoundError('TenantBillingSubscription', tenantId);
  const updated = await prisma.tenantBillingSubscription.update({
    where: { tenantId },
    data: { suspendedAt: null, suspendedUntil: null, suspendReason: null },
  });
  await prisma.billingEvent.create({
    data: {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      subscriptionId: sub.id,
      eventType: 'RESUME',
      description: '訂閱恢復（CP）',
    },
  });
  logger.info('Subscription resumed', { tenantId });
  return updated;
}
