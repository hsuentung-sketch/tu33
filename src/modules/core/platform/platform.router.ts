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
import * as billingService from '../billing/billing.service.js';
import { clearFeatureCache } from '../../../middleware/feature-gate.js';

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

/** GET /api/platform/tenants — 所有租戶（預設排除已退租；?includeDeleted=true 顯示全部） */
platformRouter.get('/tenants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeDeleted = req.query.includeDeleted === 'true';
    const tenants = await prisma.tenant.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
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

/**
 * POST /api/platform/tenants/:id/soft-delete — 退租（soft-delete，保留資料）（P1-1）。
 * 設 deletedAt + isActive=false。CP 應同時 fly scale 0。
 */
platformRouter.post('/tenants/:id/soft-delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!tenant) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到此租戶' } });
      return;
    }
    const updated = await prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: { id: true, companyName: true, deletedAt: true, isActive: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

/** POST /api/platform/tenants/:id/restore — 復租（清 deletedAt + isActive=true）（P1-1）。 */
platformRouter.post('/tenants/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到此租戶' } });
      return;
    }
    const updated = await prisma.tenant.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
      select: { id: true, companyName: true, deletedAt: true, isActive: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

/**
 * GET /api/platform/tenants/:id/export — 匯出租戶主要資料 JSON（P1-1 churn 資料導出）。
 * 供退租前備份 / 搬遷。涵蓋主檔 + 交易單據。
 */
platformRouter.get('/tenants/:id/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = String(req.params.id);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到此租戶' } });
      return;
    }
    const [
      employees, customers, suppliers, products,
      quotations, salesOrders, purchaseOrders,
      receivables, payables, einvoices, visitLogs,
    ] = await Promise.all([
      prisma.employee.findMany({ where: { tenantId } }),
      prisma.customer.findMany({ where: { tenantId } }),
      prisma.supplier.findMany({ where: { tenantId } }),
      prisma.product.findMany({ where: { tenantId } }),
      prisma.quotation.findMany({ where: { tenantId }, include: { items: true } }),
      prisma.salesOrder.findMany({ where: { tenantId }, include: { items: true } }),
      prisma.purchaseOrder.findMany({ where: { tenantId }, include: { items: true } }),
      prisma.accountReceivable.findMany({ where: { tenantId } }),
      prisma.accountPayable.findMany({ where: { tenantId } }),
      prisma.einvoice.findMany({ where: { tenantId }, include: { items: true } }),
      prisma.visitLog.findMany({ where: { tenantId } }),
    ]);

    const { settings: _omitSettings, ...tenantSafe } = tenant;
    // 不匯出 bcrypt 密碼雜湊
    const safeEmployees = employees.map((e) => {
      const { passwordHash: _pw, ...rest } = e;
      return rest;
    });
    res.setHeader('Content-Disposition', `attachment; filename="tenant-${tenantId}-export.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      tenant: tenantSafe, // 排除 settings（可能含 secret）
      counts: {
        employees: employees.length, customers: customers.length, suppliers: suppliers.length,
        products: products.length, quotations: quotations.length, salesOrders: salesOrders.length,
        purchaseOrders: purchaseOrders.length, receivables: receivables.length,
        payables: payables.length, einvoices: einvoices.length, visitLogs: visitLogs.length,
      },
      data: {
        employees: safeEmployees, customers, suppliers, products,
        quotations, salesOrders, purchaseOrders,
        receivables, payables, einvoices, visitLogs,
      },
    });
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
// Billing Sync（P0-3a：CP 推送，ERP 為 single source of truth）
// ============================================================

/**
 * POST /api/platform/billing/sync — CP 推送方案 + 訂閱（建客戶時）。
 * body: { plan: {name,monthlyPrice,annualPrice?,trialDays?,modules[],isActive?},
 *         subscription?: {tenantId, billingCycle?} }
 * 先 upsert plan（by name），再（若帶 subscription 且該租戶尚無訂閱）建立訂閱。
 */
platformRouter.post('/billing/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plan, subscription } = req.body ?? {};
    if (!plan?.name) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'plan.name 必填' } });
      return;
    }
    const upserted = await billingService.upsertPlanFromExternal({
      name: String(plan.name),
      monthlyPrice: Number(plan.monthlyPrice ?? 0),
      annualPrice: plan.annualPrice != null ? Number(plan.annualPrice) : undefined,
      trialDays: plan.trialDays != null ? Number(plan.trialDays) : undefined,
      modules: Array.isArray(plan.modules) ? plan.modules.map(String) : [],
      isActive: plan.isActive,
    });

    let sub = null;
    if (subscription?.tenantId) {
      const existing = await prisma.tenantBillingSubscription.findUnique({
        where: { tenantId: String(subscription.tenantId) },
      });
      if (!existing) {
        sub = await billingService.createSubscription({
          tenantId: String(subscription.tenantId),
          planId: upserted.id,
          billingCycle: subscription.billingCycle === 'ANNUALLY' ? 'ANNUALLY' : 'MONTHLY',
        });
      }
      clearFeatureCache(String(subscription.tenantId));
    }

    res.status(201).json({ plan: upserted, subscription: sub });
  } catch (err) { next(err); }
});

/** POST /api/platform/billing/subscriptions/:tenantId/suspend — CP suspend。 */
platformRouter.post('/billing/subscriptions/:tenantId/suspend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = String(req.params.tenantId);
    const { reason, until } = req.body ?? {};
    const updated = await billingService.suspendSubscription(
      tenantId,
      reason ? String(reason) : undefined,
      until ? new Date(until) : undefined,
    );
    clearFeatureCache(tenantId);
    res.json(updated);
  } catch (err) { next(err); }
});

/** POST /api/platform/billing/subscriptions/:tenantId/resume — CP resume。 */
platformRouter.post('/billing/subscriptions/:tenantId/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = String(req.params.tenantId);
    const updated = await billingService.resumeSubscription(tenantId);
    clearFeatureCache(tenantId);
    res.json(updated);
  } catch (err) { next(err); }
});

/** POST /api/platform/billing/invoices/:id/mark-paid — CP mark-paid（記錄付款）。 */
platformRouter.post('/billing/invoices/:id/mark-paid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await billingService.recordPayment(String(req.params.id));
    res.json(invoice);
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

/**
 * POST /api/platform/versions/record — CP 升級成功後寫入 semver + commit 紀錄（P0-V）。
 * body: { tenantId, fromVersion, toVersion, commitHash?, operatorId?, reason? }
 * 寫一筆 VersionUpgradeLog（changeType=UPGRADE）並同步 TenantVersionSubscription.currentVersion。
 */
platformRouter.post('/versions/record', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, fromVersion, toVersion, commitHash, operatorId, reason } = req.body ?? {};
    if (!tenantId || !toVersion) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'tenantId 與 toVersion 必填' } });
      return;
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) }, select: { id: true } });
    if (!tenant) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到此租戶' } });
      return;
    }

    const log = await prisma.versionUpgradeLog.create({
      data: {
        tenantId: String(tenantId),
        fromVersion: fromVersion ? String(fromVersion) : 'unknown',
        toVersion: String(toVersion),
        changeType: 'UPGRADE',
        operatorId: operatorId ? String(operatorId) : null,
        reason: reason ? String(reason) : null,
        commitHash: commitHash ? String(commitHash) : null,
      },
    });

    // 同步租戶版本訂閱的當前版本（upsert：CP 可能在 ERP 還沒建 subscription 時就 push）
    await prisma.tenantVersionSubscription.upsert({
      where: { tenantId: String(tenantId) },
      create: {
        tenantId: String(tenantId),
        currentVersion: String(toVersion),
        previousVersion: fromVersion ? String(fromVersion) : null,
        latestVersion: String(toVersion),
        lastUpgradedAt: new Date(),
      },
      update: {
        previousVersion: fromVersion ? String(fromVersion) : undefined,
        currentVersion: String(toVersion),
        lastUpgradedAt: new Date(),
      },
    });

    res.status(201).json(log);
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
