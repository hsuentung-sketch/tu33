/**
 * Feature Catalog Router
 *
 * 租戶端：查詢自己的功能與用量狀態
 * 掛載在 /api/tenant/features（經 authMiddleware 後）
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import * as featureService from './feature.service.js';

export const featureRouter = Router();

/**
 * GET /api/tenant/features
 *
 * 返回：
 * {
 *   planName: string,
 *   planId: string,
 *   enabledModules: string[],
 *   disabledModules: string[],
 *   usageLimits: UsageLimitStatus[]
 * }
 */
featureRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const features = await featureService.getTenantFeatures(req.tenantId);
      res.json(features);
    } catch (err) {
      next(err);
    }
  },
);
