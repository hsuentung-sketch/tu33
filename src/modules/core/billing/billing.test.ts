/**
 * Billing Management - End-to-End Test Cases
 *
 * Test Scenarios:
 * 1. 創建計費訂閱（試用期）
 * 2. 查詢訂閱狀態
 * 3. Plan 升級/降級（計算按比例金額）
 * 4. 結束試用期
 * 5. 生成發票
 * 6. 記錄付款
 * 7. 自動續訂
 * 8. 取消訂閱
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prisma } from '../../../shared/prisma.js';
import * as billingService from './billing.service.js';

describe('Billing Management System', () => {
  const testTenantId = 'test_billing_tenant_001';
  let planIdPro: string;
  let planIdEnterprise: string;
  let subscriptionId: string;

  beforeAll(async () => {
    // 清理測試資料
    await prisma.tenantBillingSubscription.deleteMany({
      where: { tenantId: testTenantId },
    });

    // 取得測試用 Plan ID
    const plans = await prisma.billingPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' },
    });

    if (plans.length >= 2) {
      planIdPro = plans[1].id; // 第二個計畫（e.g., Starter）
      planIdEnterprise = plans[plans.length - 1].id; // 最後一個計畫（e.g., Enterprise）
    } else {
      throw new Error('Not enough billing plans for testing');
    }
  });

  afterAll(async () => {
    // 清理測試資料
    await prisma.tenantBillingSubscription.deleteMany({
      where: { tenantId: testTenantId },
    });
  });

  describe('createSubscription', () => {
    it('should create a billing subscription with trial period', async () => {
      const result = await billingService.createSubscription({
        tenantId: testTenantId,
        planId: planIdPro,
        billingCycle: 'MONTHLY',
      });

      subscriptionId = result.id;

      expect(result.tenantId).toBe(testTenantId);
      expect(result.planId).toBe(planIdPro);
      expect(result.isInTrial).toBe(true);
      expect(result.trialEndDate).toBeDefined();
      expect(result.autoRenew).toBe(true);
    });

    it('should create SUBSCRIPTION_CREATED event', async () => {
      const events = await prisma.billingEvent.findMany({
        where: { subscriptionId },
      });

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('SUBSCRIPTION_CREATED');
    });
  });

  describe('getSubscription', () => {
    it('should retrieve subscription with plan details', async () => {
      const result = await billingService.getSubscription(testTenantId);

      expect(result.tenantId).toBe(testTenantId);
      expect(result.plan).toBeDefined();
      expect(result.plan.id).toBe(planIdPro);
    });

    it('should throw not found for non-existent tenant', async () => {
      await expect(
        billingService.getSubscription('non_existent_tenant'),
      ).rejects.toThrow('not found');
    });
  });

  describe('changePlan', () => {
    it('should upgrade plan and calculate prorated amount', async () => {
      const result = await billingService.changePlan({
        tenantId: testTenantId,
        newPlanId: planIdEnterprise,
      });

      expect(result.subscription.planId).toBe(planIdEnterprise);
      expect(result.proratedAmount).toBeDefined();
    });

    it('should create PLAN_UPGRADE event', async () => {
      const events = await prisma.billingEvent.findMany({
        where: {
          subscriptionId,
          eventType: 'PLAN_UPGRADE',
        },
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].proratedAmount).toBeDefined();
    });

    it('should fail if downgrading to same plan', async () => {
      const result = await billingService.getSubscription(testTenantId);

      await expect(
        billingService.changePlan({
          tenantId: testTenantId,
          newPlanId: result.planId,
        }),
      ).rejects.toThrow('相同');
    });
  });

  describe('endTrial', () => {
    it('should end trial and set renewal date', async () => {
      const result = await billingService.endTrial(testTenantId);

      expect(result.isInTrial).toBe(false);
      expect(result.trialEndDate).toBeNull();
      expect(result.renewalDate).toBeDefined();
    });

    it('should create TRIAL_END event', async () => {
      const events = await prisma.billingEvent.findMany({
        where: {
          subscriptionId,
          eventType: 'TRIAL_END',
        },
      });

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('generateInvoice', () => {
    it('should generate invoice for billing period', async () => {
      const billingPeriodStart = new Date();
      const result = await billingService.generateInvoice({
        subscriptionId,
        billingPeriodStart,
      });

      expect(result.subscriptionId).toBe(subscriptionId);
      expect(result.invoiceNumber).toBeDefined();
      expect(result.status).toBe('ISSUED');
      expect(result.total.toNumber()).toBeGreaterThan(0);
    });

    it('should prevent duplicate invoices for same period', async () => {
      const billingPeriodStart = new Date();

      await expect(
        billingService.generateInvoice({
          subscriptionId,
          billingPeriodStart,
        }),
      ).rejects.toThrow('已有發票');
    });

    it('should apply discount correctly', async () => {
      const billingPeriodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const discount = 10;

      const result = await billingService.generateInvoice({
        subscriptionId,
        billingPeriodStart,
        discount,
      });

      expect(result.discount.toNumber()).toBe(discount);
      expect(result.total.toNumber()).toBeLessThan(result.amount.toNumber());
    });
  });

  describe('recordPayment', () => {
    it('should mark invoice as paid', async () => {
      // 先找到一個未付款的發票
      const invoices = await prisma.invoice.findMany({
        where: { subscriptionId, status: 'ISSUED' },
        take: 1,
      });

      if (invoices.length === 0) {
        throw new Error('No unpaid invoices for testing');
      }

      const result = await billingService.recordPayment(invoices[0].id);

      expect(result.status).toBe('PAID');
      expect(result.paidAt).toBeDefined();
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription', async () => {
      const result = await billingService.cancelSubscription(testTenantId);

      expect(result.cancellationDate).toBeDefined();
      expect(result.autoRenew).toBe(false);
    });

    it('should create CANCELLATION event', async () => {
      const events = await prisma.billingEvent.findMany({
        where: {
          subscriptionId,
          eventType: 'CANCELLATION',
        },
      });

      expect(events.length).toBeGreaterThan(0);
    });

    it('should fail if already cancelled', async () => {
      await expect(
        billingService.cancelSubscription(testTenantId),
      ).rejects.toThrow('已取消');
    });
  });

  describe('getAllPlans', () => {
    it('should return all active plans', async () => {
      const plans = await billingService.getAllPlans();

      expect(plans.length).toBeGreaterThan(0);
      expect(plans.every((p) => p.isActive)).toBe(true);
    });

    it('should order by displayOrder', async () => {
      const plans = await billingService.getAllPlans();

      for (let i = 1; i < plans.length; i++) {
        expect(plans[i].displayOrder).toBeGreaterThanOrEqual(plans[i - 1].displayOrder);
      }
    });
  });

  describe('getPlanFeatures', () => {
    it('should return features for a plan', async () => {
      const features = await billingService.getPlanFeatures(planIdEnterprise);

      expect(Array.isArray(features)).toBe(true);
    });
  });
});
