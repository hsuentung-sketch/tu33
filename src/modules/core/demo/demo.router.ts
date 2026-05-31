/**
 * Demo Management Router
 * 提供演示實例重置、資料初始化等功能
 *
 * 僅在 NODE_ENV=demo | development 環境可用
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../../shared/logger.js';
import { AppError } from '../../../shared/errors.js';
import { prisma } from '../../../shared/prisma.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export const demoRouter = Router();

/**
 * POST /api/demo/reset
 * 重置演示實例資料
 * 需求環境：NODE_ENV=demo 或 development
 * 需求角色：無（公開端點，但僅在演示環境可用）
 */
demoRouter.post('/reset', async (req: Request, res: Response) => {
  // 安全檢查：只在演示 / 開發環境允許
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (!['demo', 'development'].includes(nodeEnv)) {
    throw new AppError(403, 'FORBIDDEN', 'Demo reset API 僅在演示環境可用');
  }

  try {
    logger.info('🌱 Starting demo reset...', { env: nodeEnv });

    // 執行 seed 腳本
    // 腳本路徑相對於 dist/modules/core/demo，回溯至 dist 再進 scripts
    const seedScriptPath = path.resolve(__dirname, '../../../../dist/scripts/demo-seed.js');

    const { stdout, stderr } = await execFileAsync('node', [seedScriptPath], {
      timeout: 60000, // 60 秒超時
      maxBuffer: 10 * 1024 * 1024, // 10 MB 緩衝區
    });

    if (stderr && !stderr.includes('✅')) {
      logger.warn('Demo seed stderr (non-fatal)', { stderr });
    }

    logger.info('✅ Demo reset completed successfully');

    res.json({
      status: 'success',
      message: 'Demo 資料已重置',
      timestamp: new Date().toISOString(),
      output: stdout,
    });
  } catch (err) {
    logger.error('❌ Demo reset failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    throw new AppError(500, 'DEMO_RESET_FAILED', `演示重置失敗: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
});

/**
 * GET /api/demo/status
 * 查詢演示實例狀態
 * 可在任何環境使用（但會根據環境返回不同訊息）
 */
demoRouter.get('/status', (_req: Request, res: Response) => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isDemoEnv = ['demo', 'development'].includes(nodeEnv);

  res.json({
    environment: nodeEnv,
    isDemoAvailable: isDemoEnv,
    resetApiAvailable: isDemoEnv,
    demoTenantId: isDemoEnv ? DEMO_TENANT_ID : null,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// Helper
// ============================================================

const DEMO_TENANT_ID = 'demo_eco_company_001';

function requireDemoEnv(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (!['demo', 'development'].includes(nodeEnv)) {
    throw new AppError(403, 'FORBIDDEN', 'Demo API 僅在演示環境可用');
  }
}

// ============================================================
// GET /api/demo/export — 匯出 demo 租戶資料
// ============================================================
demoRouter.get('/export', async (_req: Request, res: Response) => {
  requireDemoEnv();

  const [
    tenant,
    employees,
    customers,
    suppliers,
    products,
    salesOrders,
    purchaseOrders,
    plans,
    subscription,
  ] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: DEMO_TENANT_ID } }),
    prisma.employee.findMany({ where: { tenantId: DEMO_TENANT_ID }, orderBy: { createdAt: 'asc' } }),
    prisma.customer.findMany({ where: { tenantId: DEMO_TENANT_ID }, orderBy: { createdAt: 'asc' } }),
    prisma.supplier.findMany({ where: { tenantId: DEMO_TENANT_ID }, orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { tenantId: DEMO_TENANT_ID }, orderBy: { createdAt: 'asc' } }),
    prisma.salesOrder.findMany({
      where: { tenantId: DEMO_TENANT_ID },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId: DEMO_TENANT_ID },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.billingPlan.findMany({
      include: { planFeatures: true, usageLimits: true },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.tenantBillingSubscription.findFirst({
      where: { tenantId: DEMO_TENANT_ID },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({
    exportedAt: new Date().toISOString(),
    tenant,
    employees,
    customers,
    suppliers,
    products,
    salesOrders,
    purchaseOrders,
    billing: { plans, subscription },
  });
});

// ============================================================
// GET /api/demo/metrics — Demo 資料統計
// ============================================================
demoRouter.get('/metrics', async (_req: Request, res: Response) => {
  requireDemoEnv();

  const t = DEMO_TENANT_ID;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    employeeCount,
    customerCount,
    supplierCount,
    productCount,
    salesOrderCount,
    purchaseOrderCount,
    monthlyOrderCount,
    planCount,
    subscriptionCount,
  ] = await Promise.all([
    prisma.employee.count({ where: { tenantId: t } }),
    prisma.customer.count({ where: { tenantId: t } }),
    prisma.supplier.count({ where: { tenantId: t } }),
    prisma.product.count({ where: { tenantId: t } }),
    prisma.salesOrder.count({ where: { tenantId: t } }),
    prisma.purchaseOrder.count({ where: { tenantId: t } }),
    prisma.salesOrder.count({ where: { tenantId: t, orderDate: { gte: monthStart } } }),
    prisma.billingPlan.count(),
    prisma.tenantBillingSubscription.count({ where: { tenantId: t } }),
  ]);

  // 銷售訂單總金額
  const salesTotal = await prisma.salesOrder.aggregate({
    where: { tenantId: t },
    _sum: { totalAmount: true },
  });

  res.json({
    tenantId: t,
    timestamp: now.toISOString(),
    counts: {
      employees: employeeCount,
      customers: customerCount,
      suppliers: supplierCount,
      products: productCount,
      salesOrders: salesOrderCount,
      purchaseOrders: purchaseOrderCount,
      monthlyOrders: monthlyOrderCount,
      plans: planCount,
      subscriptions: subscriptionCount,
    },
    totals: {
      salesAmount: salesTotal._sum.totalAmount?.toNumber() ?? 0,
    },
  });
});

// ============================================================
// GET /api/demo/seed-config — 目前 seed 配置
// ============================================================
demoRouter.get('/seed-config', (_req: Request, res: Response) => {
  requireDemoEnv();

  res.json({
    tenantId: DEMO_TENANT_ID,
    tenantName: '某環保公司',
    plans: [
      {
        name: 'Starter',
        monthlyPrice: 99,
        features: ['sales', 'customers'],
        limits: { employees: 5, customers: 50, monthlyOrders: 100, products: 50 },
      },
      {
        name: 'Professional',
        monthlyPrice: 299,
        features: ['sales', 'purchase', 'customers', 'inventory', 'accounting'],
        limits: { employees: 30, customers: 500, monthlyOrders: 1000, products: 500 },
      },
      {
        name: 'Enterprise',
        monthlyPrice: 599,
        features: ['sales', 'purchase', 'customers', 'suppliers', 'inventory', 'accounting', 'commission'],
        limits: { employees: -1, customers: -1, monthlyOrders: -1, products: -1 },
      },
    ],
    seedData: {
      employees: 20,
      customers: 50,
      salesOrders: 10,
      invoices: 3,
      defaultSubscription: 'Professional',
    },
  });
});
