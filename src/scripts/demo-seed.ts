import 'dotenv/config';

/**
 * Demo Seed Script
 * 初始化演示租戶與完整測試資料
 *
 * 租戶：某環保公司
 * 員工：20 人
 * 客戶：50 家
 * 計畫：3 個（展示不同功能差異）
 *
 * 執行：npx ts-node src/scripts/demo-seed.ts
 */

import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';

const DEMO_TENANT_ID = 'demo_eco_company_001';
const DEMO_TENANT_NAME = '某環保公司';

// ============================================================
// 計畫配置（3 個計畫，展示功能差異）
// ============================================================
const PLANS = [
  {
    name: 'Starter',
    description: '基礎管理套件',
    monthlyPrice: 99,
    annualPrice: 999,
    initialSetupPrice: 50,
    yearlyDiscountPercent: 15,
    trialDays: 14,
    features: ['sales', 'customers'], // 只有銷售 + 客戶管理
    displayOrder: 1,
    usageLimits: [
      { metricType: 'employee_count', monthlyLimit: 5 },
      { metricType: 'customer_count', monthlyLimit: 50 },
      { metricType: 'monthly_order_count', monthlyLimit: 100 },
      { metricType: 'product_count', monthlyLimit: 50 },
    ],
  },
  {
    name: 'Professional',
    description: '專業營運套件',
    monthlyPrice: 299,
    annualPrice: 2999,
    initialSetupPrice: 100,
    yearlyDiscountPercent: 18,
    trialDays: 30,
    features: ['sales', 'purchase', 'customers', 'inventory', 'accounting'], // 銷售、採購、庫存、會計
    displayOrder: 2,
    usageLimits: [
      { metricType: 'employee_count', monthlyLimit: 30 },
      { metricType: 'customer_count', monthlyLimit: 500 },
      { metricType: 'monthly_order_count', monthlyLimit: 1000 },
      { metricType: 'product_count', monthlyLimit: 500 },
    ],
  },
  {
    name: 'Enterprise',
    description: '企業完整套件',
    monthlyPrice: 599,
    annualPrice: 5999,
    initialSetupPrice: 200,
    yearlyDiscountPercent: 20,
    trialDays: 60,
    features: ['sales', 'purchase', 'customers', 'suppliers', 'inventory', 'accounting', 'commission'], // 全功能
    displayOrder: 3,
    usageLimits: [
      { metricType: 'employee_count', monthlyLimit: -1 },   // 無限制
      { metricType: 'customer_count', monthlyLimit: -1 },
      { metricType: 'monthly_order_count', monthlyLimit: -1 },
      { metricType: 'product_count', monthlyLimit: -1 },
    ],
  },
];

// ============================================================
// 核心初始化函數
// ============================================================

async function seedDemo(): Promise<void> {
  logger.info('🌱 Starting demo seed...', { tenant: DEMO_TENANT_NAME });

  try {
    // 1. 清理舊資料
    await cleanupOldDemo();

    // 2. 創建租戶
    const tenant = await createDemoTenant();

    // 3. 創建計畫 & 功能
    const plans = await createPlans();

    // 4. 創建訂閱（用 Professional 計畫）
    const subscription = await createSubscription(tenant.id, plans[1].id);

    // 5. 建立版本歷史
    await createVersionHistory();

    // 6. 創建員工
    const employees = await createEmployees(tenant.id);

    // 7. 創建客戶
    const customers = await createCustomers(tenant.id);

    // 8. 創建訂單 & 發票
    await createSalesOrders(tenant.id, customers.slice(0, 10));
    await createInvoices(subscription.id);

    logger.info('✅ Demo seed completed successfully!', {
      tenant: DEMO_TENANT_NAME,
      employees: employees.length,
      customers: customers.length,
      plans: plans.length,
    });
  } catch (err) {
    logger.error('❌ Demo seed failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

// ============================================================
// 清理舊資料
// ============================================================
async function cleanupOldDemo(): Promise<void> {
  logger.info('🗑️ Cleaning up old demo data...');

  // 用 raw SQL 按 FK 依賴順序刪除，每條 try-catch 避免中斷
  const t = DEMO_TENANT_ID;

  async function run(sql: string, ...params: any[]) {
    try { await prisma.$executeRawUnsafe(sql, ...params); } catch { /* skip */ }
  }

  // === 1. Billing 子表（全域，非 tenantId）===
  // Invoice/BillingEvent/UsageMetric → Subscription → Plan
  await run(`DELETE FROM "Invoice" WHERE "subscriptionId" IN (SELECT id FROM "TenantBillingSubscription" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "BillingEvent" WHERE "subscriptionId" IN (SELECT id FROM "TenantBillingSubscription" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "UsageMetric" WHERE "subscriptionId" IN (SELECT id FROM "TenantBillingSubscription" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "TenantBillingSubscription" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "VersionUpgradeLog" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "BillingSubscriptionLog" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "TenantVersionSubscription" WHERE "tenantId" = $1`, t);

  // === 2. 全域表（無 tenantId）：Plan 相關 + Version ===
  // PlanFeature → BillingPlan；先刪子表
  await run(`DELETE FROM "UsageOverageRate"`);
  await run(`DELETE FROM "UsageLimit"`);
  await run(`DELETE FROM "PlanFeature"`);
  await run(`DELETE FROM "BillingPlan"`);
  await run(`DELETE FROM "VersionHistory"`);

  // === 3. 訂單子項 ===
  await run(`DELETE FROM "SalesItem" WHERE "salesOrderId" IN (SELECT id FROM "SalesOrder" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "SalesOrder" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "QuotationItem" WHERE "quotationId" IN (SELECT id FROM "Quotation" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "Quotation" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "PurchaseItem" WHERE "purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "PurchaseOrder" WHERE "tenantId" = $1`, t);

  // === 4. 電子發票 ===
  await run(`DELETE FROM "EinvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Einvoice" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "EinvoiceAllowanceItem" WHERE "allowanceId" IN (SELECT id FROM "EinvoiceAllowance" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "EinvoiceAllowance" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "Einvoice" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "EinvoiceNumberPool" WHERE "tenantId" = $1`, t);

  // === 5. 會計 ===
  await run(`DELETE FROM "JournalLine" WHERE "entryId" IN (SELECT id FROM "JournalEntry" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "JournalEntry" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "ChartOfAccount" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "FiscalPeriod" WHERE "tenantId" = $1`, t);

  // === 6. 其他 tenantId 直屬表 ===
  await run(`DELETE FROM "AccountReceivable" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "AccountPayable" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "InventoryTransaction" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "Inventory" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "ProductDocument" WHERE "productId" IN (SELECT id FROM "Product" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "SupplierDocument" WHERE "supplierId" IN (SELECT id FROM "Supplier" WHERE "tenantId" = $1)`, t);
  await run(`DELETE FROM "VisitLog" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "ErrorLog" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "ShortLink" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "AuditLog" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "Employee" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "Customer" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "Supplier" WHERE "tenantId" = $1`, t);
  await run(`DELETE FROM "Product" WHERE "tenantId" = $1`, t);

  // === 7. 最後刪租戶 ===
  await run(`DELETE FROM "Tenant" WHERE "id" = $1`, t);

  logger.info('✓ Cleanup complete');
}

// ============================================================
// 創建租戶
// ============================================================
async function createDemoTenant(): Promise<any> {
  const tenant = await prisma.tenant.create({
    data: {
      id: DEMO_TENANT_ID,
      companyName: DEMO_TENANT_NAME,
      taxId: '11223344', // 假統編
      phone: '02-2345-6789',
      email: 'demo@ecoco.com.tw',
      address: '台北市南港區某路 123 號',
      modules: ['sales', 'purchase', 'accounting', 'inventory'],
      isActive: true,
    },
  });

  logger.info('✓ Tenant created', { id: tenant.id, name: tenant.companyName });
  return tenant;
}

// ============================================================
// 創建計畫 & 功能
// ============================================================
async function createPlans(): Promise<any[]> {
  const plans = [];

  for (const planConfig of PLANS) {
    const plan = await prisma.billingPlan.create({
      data: {
        id: `plan_${planConfig.name.toLowerCase()}_${Date.now()}`,
        name: planConfig.name,
        description: planConfig.description,
        monthlyPrice: planConfig.monthlyPrice,
        annualPrice: planConfig.annualPrice,
        initialSetupPrice: planConfig.initialSetupPrice,
        yearlyPrice: planConfig.annualPrice * (1 - planConfig.yearlyDiscountPercent / 100),
        yearlyDiscountPercent: planConfig.yearlyDiscountPercent,
        trialDays: planConfig.trialDays,
        isActive: true,
        displayOrder: planConfig.displayOrder,
      },
    });

    // 添加功能
    for (const feature of planConfig.features) {
      await prisma.planFeature.create({
        data: {
          id: `feat_${plan.id}_${feature}_${Date.now()}`,
          planId: plan.id,
          feature,
          enabled: true,
        },
      });
    }

    // 添加用量上限
    for (const ul of planConfig.usageLimits) {
      await prisma.usageLimit.create({
        data: {
          planId: plan.id,
          metricType: ul.metricType,
          monthlyLimit: ul.monthlyLimit,
        },
      });
    }

    plans.push(plan);

    logger.info(`✓ Plan created: ${plan.name}`, {
      monthlyPrice: planConfig.monthlyPrice,
      features: planConfig.features.join(', '),
      usageLimits: planConfig.usageLimits.length,
    });
  }

  return plans;
}

// ============================================================
// 創建訂閱
// ============================================================
async function createSubscription(tenantId: string, planId: string): Promise<any> {
  const subscription = await prisma.tenantBillingSubscription.create({
    data: {
      id: `sub_demo_${Date.now()}`,
      tenantId,
      planId,
      billingCycle: 'MONTHLY',
      isInTrial: false,
      trialEndDate: null,
      subscriptionStart: new Date(),
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      autoRenew: true,
    },
  });

  logger.info('✓ Subscription created', { planId, billingCycle: 'MONTHLY' });
  return subscription;
}

// ============================================================
// 創建版本歷史（展示版本管理功能）
// ============================================================
async function createVersionHistory(): Promise<void> {
  const versions = [
    { version: '1.0.0', features: ['基礎訂單管理', '客戶管理'] },
    { version: '2.0.0', features: ['採購管理', '庫存管理'] },
    { version: '2.5.0', features: ['會計模組', '報表功能'] },
    { version: '3.0.0', features: ['多幣種支持', '進階報表', '自動化工作流'] },
  ];

  for (let i = 0; i < versions.length; i++) {
    const version = versions[i];
    const releaseDate = new Date(Date.now() - (versions.length - i - 1) * 30 * 24 * 60 * 60 * 1000);

    await prisma.versionHistory.create({
      data: {
        id: `ver_${version.version.replace(/\./g, '_')}_${Date.now()}`,
        version: version.version,
        releaseDate,
        supportedUntil: new Date(releaseDate.getTime() + 30 * 24 * 60 * 60 * 1000),
        features: version.features,
        isActive: i >= versions.length - 2, // 最後 2 個版本活躍
      },
    });
  }

  // 創建租戶版本訂閱
  await prisma.tenantVersionSubscription.create({
    data: {
      id: `tenver_demo_${Date.now()}`,
      tenantId: DEMO_TENANT_ID,
      currentVersion: '2.5.0',
      latestVersion: '3.0.0',
      upgradeDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  logger.info('✓ Version history created', { versions: versions.length });
}

// ============================================================
// 創建員工（20 人）
// ============================================================
async function createEmployees(tenantId: string): Promise<any[]> {
  const employees = [];
  const roles = ['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING'];

  for (let i = 1; i <= 20; i++) {
    const role = roles[i % roles.length];
    const employee = await prisma.employee.create({
      data: {
        id: `emp_demo_${i}`,
        tenantId,
        employeeId: `E${String(i).padStart(4, '0')}`,
        name: `員工 ${i}`,
        email: `employee${i}@ecoco.demo`,
        phone: `09${String(i).padStart(8, '0')}`,
        role: role as any,
        isActive: true,
      },
    });

    employees.push(employee);
  }

  logger.info('✓ Employees created', { count: employees.length });
  return employees;
}

// ============================================================
// 創建客戶（50 家）
// ============================================================
async function createCustomers(tenantId: string): Promise<any[]> {
  const customers = [];
  const industries = ['製造', '批發', '零售', '服務', '其他'];

  for (let i = 1; i <= 50; i++) {
    const customer = await prisma.customer.create({
      data: {
        id: `cust_demo_${i}`,
        tenantId,
        name: `客戶公司 ${i}`,
        contactName: `聯絡人 ${i}`,
        taxId: `${String(i).padStart(8, '0')}`,
        phone: `02-${String(i).padStart(4, '0')}-${String(i * 100).padStart(4, '0')}`,
        address: `台北市某區某路 ${i} 號`,
        paymentDays: 30,
        grade: ['A', 'B', 'C'][i % 3] as any,
        tags: [industries[i % industries.length]],
        isActive: true,
      },
    });

    customers.push(customer);
  }

  logger.info('✓ Customers created', { count: customers.length });
  return customers;
}

// ============================================================
// 創建銷售訂單
// ============================================================
async function createSalesOrders(tenantId: string, customers: any[]): Promise<void> {
  for (let i = 0; i < Math.min(10, customers.length); i++) {
    const customer = customers[i];
    const lineItems = [
      { productCode: 'PROD001', quantity: 10, unitPrice: 100 },
      { productCode: 'PROD002', quantity: 5, unitPrice: 250 },
    ];

    const totalAmount = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    await prisma.salesOrder.create({
      data: {
        id: `so_demo_${i}`,
        tenantId,
        customerId: customer.id,
        orderNo: `SO-${String(i + 1).padStart(5, '0')}`,
        orderDate: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000),
        totalAmount: totalAmount,
        subtotal: totalAmount,
        taxAmount: 0,
        status: ['PENDING', 'DELIVERED', 'COMPLETED'][i % 3] as any,
        salesPerson: `sales_${i % 5}`,
        createdBy: `emp_demo_${i % 20 || 1}`,
      },
    });
  }

  logger.info('✓ Sales orders created', { count: Math.min(10, customers.length) });
}

// ============================================================
// 創建發票
// ============================================================
async function createInvoices(subscriptionId: string): Promise<void> {
  const months = [0, -30, -60]; // 當月、上月、上上月

  for (const monthOffset of months) {
    const billingPeriodStart = new Date(Date.now() + monthOffset * 24 * 60 * 60 * 1000);
    billingPeriodStart.setDate(1);

    try {
      await prisma.invoice.create({
        data: {
          id: `inv_demo_${monthOffset}`,
          invoiceNumber: `INV-DEMO-${new Date(billingPeriodStart).getFullYear()}${String(billingPeriodStart.getMonth() + 1).padStart(2, '0')}`,
          subscriptionId,
          billingPeriodStart,
          billingPeriodEnd: new Date(billingPeriodStart.getFullYear(), billingPeriodStart.getMonth() + 1, 0),
          amount: 299, // Professional 計畫月費
          discount: 0,
          tax: 0,
          total: 299,
          status: monthOffset === 0 ? 'ISSUED' : 'PAID',
          issuedAt: monthOffset === 0 ? new Date() : new Date(Date.now() + monthOffset * 24 * 60 * 60 * 1000),
          paidAt: monthOffset === 0 ? null : new Date(Date.now() + (monthOffset + 5) * 24 * 60 * 60 * 1000),
          dueDate: new Date(billingPeriodStart.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      // 重複發票會失敗，忽略
    }
  }

  logger.info('✓ Invoices created');
}

// ============================================================
// 執行
// ============================================================
seedDemo()
  .then(() => {
    logger.info('🎉 Demo seed finished!');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('💥 Fatal error', { error: err });
    process.exit(1);
  });
