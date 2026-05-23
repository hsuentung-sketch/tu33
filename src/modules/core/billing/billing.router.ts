import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/auth.middleware.js';
import { ValidationError } from '../../../shared/errors.js';
import * as billingService from './billing.service.js';

export const billingRouter = Router();

const createSubscriptionSchema = z.object({
  planId: z.string().min(1),
  billingCycle: z.enum(['MONTHLY', 'ANNUALLY']),
});

const changePlanSchema = z.object({
  newPlanId: z.string().min(1),
});

const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1),
});

/**
 * [ADMIN] 為租戶創建計費訂閱
 * POST /api/billing/subscriptions
 *
 * 流程：
 * 1. 驗證 Plan 存在且活躍
 * 2. 初始化試用期
 * 3. 創建 SUBSCRIPTION_CREATED 事件
 */
billingRouter.post(
  '/subscriptions',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const subscription = await billingService.createSubscription({
        tenantId: req.tenantId,
        planId: parsed.data.planId,
        billingCycle: parsed.data.billingCycle,
      });

      res.status(201).json({
        message: '計費訂閱已創建',
        subscription,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 查詢租戶的計費訂閱狀態
 * GET /api/billing/me
 */
billingRouter.get(
  '/me',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subscription = await billingService.getSubscription(req.tenantId);
      res.json(subscription);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 升級/降級 Plan
 * POST /api/billing/change-plan
 *
 * 流程：
 * 1. 驗證新 Plan 存在且活躍
 * 2. 計算按比例金額
 * 3. 創建 PLAN_UPGRADE / PLAN_DOWNGRADE 事件
 */
billingRouter.post(
  '/change-plan',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = changePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const result = await billingService.changePlan({
        tenantId: req.tenantId,
        newPlanId: parsed.data.newPlanId,
      });

      res.json({
        message: '計費方案已更新',
        subscription: result.subscription,
        proratedAmount: result.proratedAmount,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 結束試用期
 * POST /api/billing/end-trial
 */
billingRouter.post(
  '/end-trial',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subscription = await billingService.endTrial(req.tenantId);
      res.json({
        message: '試用期已結束',
        subscription,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [TENANT] 取消訂閱
 * POST /api/billing/cancel
 */
billingRouter.post(
  '/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subscription = await billingService.cancelSubscription(req.tenantId);
      res.json({
        message: '訂閱已取消',
        subscription,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [PUBLIC] 查詢所有計費方案
 * GET /api/billing/plans
 */
billingRouter.get(
  '/plans',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const plans = await billingService.getAllPlans();
      res.json(plans);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [PUBLIC] 查詢 Plan 的功能列表
 * GET /api/billing/plans/:planId/features
 */
billingRouter.get(
  '/plans/:planId/features',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const features = await billingService.getPlanFeatures((req.params.planId as string));
      res.json({ features });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 手動生成發票
 * POST /api/billing/invoices
 */
billingRouter.post(
  '/invoices',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { subscriptionId, billingPeriodStart, discount, notes } = req.body;

      if (!subscriptionId || !billingPeriodStart) {
        throw new ValidationError('缺少必要欄位');
      }

      const invoice = await billingService.generateInvoice({
        subscriptionId,
        billingPeriodStart: new Date(billingPeriodStart),
        discount: discount ? parseFloat(discount) : undefined,
        notes,
      });

      res.status(201).json({
        message: '發票已生成',
        invoice,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 記錄付款
 * POST /api/billing/pay
 */
billingRouter.post(
  '/pay',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = recordPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const invoice = await billingService.recordPayment(parsed.data.invoiceId);
      res.json({
        message: '付款已記錄',
        invoice,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * [ADMIN] 手動觸發自動續訂
 * POST /api/billing/auto-renew
 */
billingRouter.post(
  '/auto-renew',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await billingService.autoRenewSubscriptions();
      res.json({
        message: '自動續訂已執行',
        results,
      });
    } catch (err) {
      next(err);
    }
  },
);
