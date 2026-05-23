import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/auth.middleware.js';
import { ValidationError } from '../../../shared/errors.js';
import * as advancedBillingService from './billing-advanced.service.js';

export const advancedBillingRouter = Router();

// ============================================================
// 1. 年繳優惠 + 首次設計價格 API
// ============================================================

/**
 * [PUBLIC] 計算首次訂閱費用
 * GET /api/billing/plans/:planId/initial-cost?billingCycle=MONTHLY
 */
advancedBillingRouter.get(
  '/plans/:planId/initial-cost',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId } = req.params as { planId: string };
      const billingCycle = (req.query.billingCycle as string) || 'MONTHLY';

      if (!['MONTHLY', 'ANNUALLY'].includes(billingCycle)) {
        throw new ValidationError('無效的計費週期');
      }

      const cost = await advancedBillingService.calculateInitialSubscriptionCost({
        planId,
        billingCycle: billingCycle as 'MONTHLY' | 'ANNUALLY',
      });

      res.json(cost);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 更新計畫年繳定價
 * POST /api/billing/plans/:planId/yearly-pricing
 */
advancedBillingRouter.post(
  '/plans/:planId/yearly-pricing',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId } = req.params as { planId: string };
      const { initialSetupPrice, monthlyPrice, yearlyDiscountPercent } = req.body;

      const updated = await advancedBillingService.updatePlanYearlyPricing({
        planId,
        initialSetupPrice: initialSetupPrice ? parseFloat(initialSetupPrice) : undefined,
        monthlyPrice: monthlyPrice ? parseFloat(monthlyPrice) : undefined,
        yearlyDiscountPercent: yearlyDiscountPercent ? parseFloat(yearlyDiscountPercent) : undefined,
      });

      res.json({
        message: '計畫年繳定價已更新',
        plan: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// 2. 逾期發票管理 API
// ============================================================

/**
 * [ADMIN] 手動觸發逾期檢查
 * POST /api/billing/invoices/mark-overdue
 */
advancedBillingRouter.post(
  '/invoices/mark-overdue',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { overdueDays } = req.body;

      const results = await advancedBillingService.markOverdueInvoices({
        overdueDays: overdueDays ? parseInt(overdueDays) : 30,
      });

      res.json({
        message: '逾期檢查已完成',
        results,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 記錄逾期催款通知
 * POST /api/billing/invoices/:invoiceId/send-reminder
 */
advancedBillingRouter.post(
  '/invoices/:invoiceId/send-reminder',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invoiceId } = req.params as { invoiceId: string };

      const invoice = await advancedBillingService.recordOverdueReminder(invoiceId);

      res.json({
        message: '催款通知已記錄',
        invoice,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// 3. 訂閱暫停/恢復 API（ADMIN 限制）
// ============================================================

/**
 * [ADMIN] 暫停租戶訂閱
 * POST /api/billing/subscriptions/:tenantId/suspend
 */
advancedBillingRouter.post(
  '/subscriptions/:tenantId/suspend',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params as { tenantId: string };
      const { reason, suspendUntil } = req.body;

      if (!reason) {
        throw new ValidationError('須提供暫停原因');
      }

      const subscription = await advancedBillingService.suspendSubscription({
        tenantId,
        reason,
        suspendUntil: suspendUntil ? new Date(suspendUntil) : undefined,
      });

      res.json({
        message: '訂閱已暫停',
        subscription,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 恢復租戶訂閱
 * POST /api/billing/subscriptions/:tenantId/resume
 */
advancedBillingRouter.post(
  '/subscriptions/:tenantId/resume',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params as { tenantId: string };

      const result = await advancedBillingService.resumeSubscription(tenantId);

      res.json({
        message: '訂閱已恢復',
        subscription: result.subscription,
        proratedFee: result.proratedFee,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// 4. 使用量計費 API
// ============================================================

/**
 * [SYSTEM] 記錄使用量指標
 * POST /api/billing/usage/track
 */
advancedBillingRouter.post(
  '/usage/track',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { subscriptionId, metricType, value } = req.body;

      if (!subscriptionId || !metricType || value === undefined) {
        throw new ValidationError('缺少必要欄位');
      }

      const metric = await advancedBillingService.trackUsage({
        subscriptionId,
        metricType,
        value: parseFloat(value),
      });

      res.json({
        message: '使用量已記錄',
        metric,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 計算月度使用量超額費用
 * GET /api/billing/subscriptions/:subscriptionId/usage-overage?billingMonth=2026-05
 */
advancedBillingRouter.get(
  '/subscriptions/:subscriptionId/usage-overage',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { subscriptionId } = req.params as { subscriptionId: string };
      const { billingMonth } = req.query;

      if (!billingMonth) {
        throw new ValidationError('須提供 billingMonth（格式：YYYY-MM）');
      }

      const billingMonthDate = new Date(`${billingMonth}-01`);

      const overage = await advancedBillingService.calculateMonthlyUsageOverage({
        subscriptionId,
        billingMonth: billingMonthDate,
      });

      res.json(overage);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 設定計畫使用量限制
 * POST /api/billing/plans/:planId/usage-limit
 */
advancedBillingRouter.post(
  '/plans/:planId/usage-limit',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId } = req.params as { planId: string };
      const { metricType, monthlyLimit } = req.body;

      if (!metricType || !monthlyLimit) {
        throw new ValidationError('缺少必要欄位');
      }

      const limit = await advancedBillingService.setUsageLimit({
        planId,
        metricType,
        monthlyLimit: parseFloat(monthlyLimit),
      });

      res.json({
        message: '使用量限制已設定',
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 設定計畫超額費率
 * POST /api/billing/plans/:planId/usage-overage-rate
 */
advancedBillingRouter.post(
  '/plans/:planId/usage-overage-rate',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId } = req.params as { planId: string };
      const { metricType, ratePerUnit } = req.body;

      if (!metricType || !ratePerUnit) {
        throw new ValidationError('缺少必要欄位');
      }

      const rate = await advancedBillingService.setUsageOverageRate({
        planId,
        metricType,
        ratePerUnit: parseFloat(ratePerUnit),
      });

      res.json({
        message: '超額費率已設定',
        rate,
      });
    } catch (err) {
      next(err);
    }
  },
);
