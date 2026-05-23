/**
 * Platform Admin API — SaaS 主控台用
 * 跨租戶查詢，不需 tenant auth，但需要 platform secret 驗證
 *
 * 掛載在 /api/platform，在 authMiddleware 之前 mount
 * 用 X-Platform-Key header 或 query 參數驗證
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../../shared/prisma.js';
import * as featureService from '../feature/feature.service.js';

export const platformRouter = Router();

// 開發/demo 環境不設 platform key
const PLATFORM_KEY = process.env.PLATFORM_ADMIN_KEY || '';

function platformAuth(req: Request, res: Response, next: NextFunction) {
  const env = process.env.NODE_ENV || 'development';
  // 開發/demo 環境跳過驗證
  if (['development', 'demo'].includes(env)) return next();
  const key = req.headers['x-platform-key'] as string || req.query.key as string;
  if (!PLATFORM_KEY || key !== PLATFORM_KEY) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid platform key' } });
    return;
  }
  next();
}

platformRouter.use(platformAuth);

// ============================================================
// Dashboard Overview
// ============================================================

/** GET /api/platform/dashboard — 總覽數據 */
platformRouter.get('/dashboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      tenantCount,
      activeTenants,
      employeeCount,
      customerCount,
      subscriptionCount,
      planCount,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.employee.count(),
      prisma.customer.count(),
      prisma.tenantBillingSubscription.count(),
      prisma.billingPlan.count({ where: { isActive: true } }),
    ]);

    // MRR 粗估（所有 MONTHLY 訂閱的 plan monthlyPrice 加總）
    const subscriptions = await prisma.tenantBillingSubscription.findMany({
      include: { plan: { select: { monthlyPrice: true, annualPrice: true } } },
    });
    let mrr = 0;
    for (const s of subscriptions) {
      mrr += Number(s.plan.monthlyPrice);
    }

    res.json({
      tenants: { total: tenantCount, active: activeTenants },
      employees: employeeCount,
      customers: customerCount,
      subscriptions: subscriptionCount,
      plans: planCount,
      mrr,
    });
  } catch (err) { next(err); }
});

// ============================================================
// Tenants
// ============================================================

/** GET /api/platform/tenants — 所有租戶 */
platformRouter.get('/tenants', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        taxId: true,
        phone: true,
        email: true,
        modules: true,
        isActive: true,
        createdAt: true,
        _count: { select: { employees: true, customers: true, salesOrders: true } },
        billingSubscription: {
          select: {
            id: true,
            billingCycle: true,
            isInTrial: true,
            renewalDate: true,
            suspendedAt: true,
            plan: { select: { name: true, monthlyPrice: true } },
          },
        },
        versionSubscription: {
          select: { currentVersion: true, previousVersion: true, latestVersion: true, upgradeDeadline: true },
        },
      },
    });
    res.json(tenants);
  } catch (err) { next(err); }
});

// ============================================================
// Billing Plans
// ============================================================

/** GET /api/platform/plans — 所有計費計畫（含功能列表） */
platformRouter.get('/plans', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.billingPlan.findMany({
      orderBy: { displayOrder: 'asc' },
      include: {
        planFeatures: { select: { feature: true, enabled: true } },
        _count: { select: { subscriptions: true } },
      },
    });
    res.json(plans);
  } catch (err) { next(err); }
});

// ============================================================
// Subscriptions
// ============================================================

/** GET /api/platform/subscriptions — 所有訂閱 */
platformRouter.get('/subscriptions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const subs = await prisma.tenantBillingSubscription.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { companyName: true } },
        plan: { select: { name: true, monthlyPrice: true } },
        invoices: {
          orderBy: { issuedAt: 'desc' },
          take: 3,
          select: { id: true, invoiceNumber: true, total: true, status: true, issuedAt: true, paidAt: true },
        },
      },
    });
    res.json(subs);
  } catch (err) { next(err); }
});

// ============================================================
// Versions
// ============================================================

/** GET /api/platform/versions — 版本歷史 + 升級歷程 */
platformRouter.get('/versions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [versions, tenantVersions, upgradeLogs] = await Promise.all([
      prisma.versionHistory.findMany({
        orderBy: { releaseDate: 'desc' },
      }),
      prisma.tenantVersionSubscription.findMany({
        include: { tenant: { select: { companyName: true } } },
      }),
      prisma.versionUpgradeLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { tenant: { select: { companyName: true } } },
      }),
    ]);
    res.json({ versions, tenantVersions, upgradeLogs });
  } catch (err) { next(err); }
});

// ============================================================
// Invoices
// ============================================================

/** GET /api/platform/invoices — 所有發票 */
platformRouter.get('/invoices', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const invoices = await prisma.invoice.findMany({
      orderBy: { issuedAt: 'desc' },
      take: 50,
      include: {
        subscription: {
          select: { tenant: { select: { companyName: true } }, plan: { select: { name: true } } },
        },
      },
    });
    res.json(invoices);
  } catch (err) { next(err); }
});

// ============================================================
// Features (Feature Catalog)
// ============================================================

/** GET /api/platform/features — 全租戶功能與用量狀態 */
platformRouter.get('/features', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const overview = await featureService.getAllTenantsFeatures();
    res.json(overview);
  } catch (err) { next(err); }
});
