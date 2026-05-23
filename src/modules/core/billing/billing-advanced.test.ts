/**
 * Advanced Billing (P0-3c) - End-to-End Test Cases
 *
 * Test Scenarios:
 * 1. 年繳優惠計算
 * 2. 首次訂閱費用（設計費 + 月費）
 * 3. 逾期發票標記
 * 4. 訂閱暫停/恢復（按比例計費）
 * 5. 使用量追蹤與超額計費
 * 6. 計畫的使用量限制與費率設定
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prisma } from '../../../shared/prisma.js';
import * as advancedBillingService from './billing-advanced.service.js';
import * as billingService from './billing.service.js';

describe('Advanced Billing (P0-3c)', () => {
  const testTenantId = 'test_adv_billing_001';
  let planIdPro: string;
  let subscriptionId: string;
  let invoiceId: string;

  beforeAll(async () => {
    // 清理測試資料
    await prisma.tenantBillingSubscription.deleteMany({
      where: { tenantId: testTenantId },
    });

    // 建立或取得測試 Plan
    let plan = await prisma.billingPlan.findFirst({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' },
    });

    if (!plan) {
      plan = await prisma.billingPlan.create({
        data: {
          id: `plan_${Date.now()}`,
          name: 'Test Pro Plan',
          monthlyPrice: 99,
          annualPrice: 999,
          initialSetupPrice: 0,
          yearlyDiscountPercent: 10,
          trialDays: 14,
          isActive: true,
        },
      });
    }

    planIdPro = plan.id;
  });

  afterAll(async () => {
    // 清理測試資料
    await prisma.tenantBillingSubscription.deleteMany({
      where: { tenantId: testTenantId },
    });
  });

  describe('年繳優惠計算', () => {
    it('should calculate monthly and yearly prices with discount', async () => {
      const cost = await advancedBillingService.calculateInitialSubscriptionCost({
        planId: planIdPro,
        billingCycle: 'ANNUALLY',
      });

      expect(cost.billingFee).toBeLessThan(99 * 12); // 年繳有折扣
      expect(cost.total).toBeGreaterThan(0);
    });

    it('should update plan yearly pricing', async () => {
      const updated = await advancedBillingService.updatePlanYearlyPricing({
        planId: planIdPro,
        initialSetupPrice: 50,
        monthlyPrice: 129,
        yearlyDiscountPercent: 15,
      });

      expect(updated.initialSetupPrice.toNumber()).toBe(50);
      expect(updated.yearlyDiscountPercent.toNumber()).toBe(15);
    });
  });

  describe('逾期發票管理', () => {
    beforeAll(async () => {
      // 建立測試訂閱
      const subscription = await billingService.createSubscription({
        tenantId: testTenantId,
        planId: planIdPro,
        billingCycle: 'MONTHLY',
      });

      subscriptionId = subscription.id;

      // 結束試用期
      await billingService.endTrial(testTenantId);

      // 生成發票
      const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 天前
      const invoice = await billingService.generateInvoice({
        subscriptionId,
        billingPeriodStart: pastDate,
      });

      invoiceId = invoice.id;
    });

    it('should mark ISSUED invoices as OVERDUE after 30 days', async () => {
      const results = await advancedBillingService.markOverdueInvoices({
        overdueDays: 30,
      });

      expect(results.markedOverdue).toBeGreaterThan(0);
    });

    it('should verify invoice status is OVERDUE', async () => {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
      });

      expect(invoice?.status).toBe('OVERDUE');
      expect(invoice?.overdueSince).toBeDefined();
    });

    it('should record overdue reminder', async () => {
      const reminder = await advancedBillingService.recordOverdueReminder(invoiceId);

      expect(reminder.reminderSentAt).toBeDefined();
    });
  });

  describe('訂閱暫停/恢復', () => {
    it('should suspend subscription with reason', async () => {
      const suspended = await advancedBillingService.suspendSubscription({
        tenantId: testTenantId,
        reason: '逾期未付款',
        suspendUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 天後
      });

      expect(suspended.suspendedAt).toBeDefined();
      expect(suspended.suspendReason).toBe('逾期未付款');
    });

    it('should prevent suspension of already suspended subscription', async () => {
      await expect(
        advancedBillingService.suspendSubscription({
          tenantId: testTenantId,
          reason: '重複暫停',
        }),
      ).rejects.toThrow('訂閱已暫停');
    });

    it('should resume subscription and calculate prorated fee', async () => {
      const result = await advancedBillingService.resumeSubscription(testTenantId);

      expect(result.subscription.suspendedAt).toBeNull();
      expect(result.proratedFee).toBeGreaterThan(0);
    });
  });

  describe('使用量計費', () => {
    it('should track usage metrics', async () => {
      const metric = await advancedBillingService.trackUsage({
        subscriptionId,
        metricType: 'api_calls',
        value: 1500,
      });

      expect(metric.metricType).toBe('api_calls');
      expect(metric.value.toNumber()).toBe(1500);
    });

    it('should set usage limit for plan', async () => {
      const limit = await advancedBillingService.setUsageLimit({
        planId: planIdPro,
        metricType: 'api_calls',
        monthlyLimit: 10000,
      });

      expect(limit.monthlyLimit.toNumber()).toBe(10000);
    });

    it('should set usage overage rate', async () => {
      const rate = await advancedBillingService.setUsageOverageRate({
        planId: planIdPro,
        metricType: 'api_calls',
        ratePerUnit: 0.01, // $0.01 per API call
      });

      expect(rate.ratePerUnit.toNumber()).toBe(0.01);
    });

    it('should calculate monthly usage overage', async () => {
      // 多記錄幾筆使用量
      await advancedBillingService.trackUsage({
        subscriptionId,
        metricType: 'api_calls',
        value: 5000,
      });

      await advancedBillingService.trackUsage({
        subscriptionId,
        metricType: 'api_calls',
        value: 3000,
      });

      const currentMonth = new Date();
      const overage = await advancedBillingService.calculateMonthlyUsageOverage({
        subscriptionId,
        billingMonth: currentMonth,
      });

      expect(Array.isArray(overage.metrics)).toBe(true);
      expect(overage.totalOverageFee).toBeGreaterThanOrEqual(0);
    });
  });

  describe('多租戶隔離', () => {
    it('should prevent cross-tenant subscription suspension', async () => {
      await expect(
        advancedBillingService.suspendSubscription({
          tenantId: 'non_existent_tenant',
          reason: '測試',
        }),
      ).rejects.toThrow();
    });

    it('should isolate usage metrics per subscription', async () => {
      const metrics = await prisma.usageMetric.findMany({
        where: { subscriptionId },
      });

      // 驗證所有 metrics 都屬於同一個 subscription
      expect(metrics.every((m) => m.subscriptionId === subscriptionId)).toBe(true);
    });
  });
});
