import { Router } from 'express';
import { authMiddleware } from '../modules/core/auth/auth.middleware.js';
import { authRouter } from '../modules/core/auth/auth.router.js';
import { webAuthRouter } from '../modules/core/auth/web-auth.router.js';
import { employeeRouter } from '../modules/core/employee/employee.router.js';
import { productRouter } from '../modules/master/product/product.router.js';
import { customerRouter } from '../modules/master/customer/customer.router.js';
import { visitLogRouter } from '../modules/master/visit-log/visit-log.router.js';
import { supplierRouter } from '../modules/master/supplier/supplier.router.js';
import { quotationRouter } from '../modules/sales/quotation/quotation.router.js';
import { salesOrderRouter } from '../modules/sales/sales-order/sales-order.router.js';
import { commissionRouter } from '../modules/sales/commission/commission.router.js';
import { purchaseOrderRouter } from '../modules/purchase/purchase-order/purchase-order.router.js';
import { receivableRouter } from '../modules/accounting/receivable/receivable.router.js';
import { payableRouter } from '../modules/accounting/payable/payable.router.js';
import { einvoiceRouter } from '../modules/accounting/einvoice/einvoice.router.js';
import { einvoicePoolRouter } from '../modules/accounting/einvoice/number-pool.router.js';
import { allowanceRouter } from '../modules/accounting/einvoice/allowance.router.js';
import { accountingRouter } from '../modules/accounting/accounting.router.js';
import { inventoryRouter } from '../modules/inventory/inventory.router.js';
import { refurbishRouter } from '../modules/inventory/refurbish/refurbish.router.js';
import { machineRecordRouter } from '../modules/master/machine-record/machine-record.router.js';
import { statementsRouter } from './statements.router.js';
import { auditLogRouter } from '../modules/core/audit-log/audit-log.router.js';
import { errorLogRouter } from '../modules/core/error-log/error-log.router.js';
import { tenantRouter } from '../modules/core/tenant/tenant.router.js';
import { versionRouter } from '../modules/core/version/version.router.js';
import { billingRouter } from '../modules/core/billing/billing.router.js';
import { advancedBillingRouter } from '../modules/core/billing/billing-advanced.router.js';
import { featureRouter } from '../modules/core/feature/feature.router.js';
import { requireModule } from '../middleware/feature-gate.js';
import { demoRouter } from '../modules/core/demo/demo.router.js';
import { VERSION_INFO } from '../shared/version.js';

export const apiRouter = Router();

// auth router handles its own auth per-route (bind/code needs ADMIN)
apiRouter.use('/auth', authRouter);
// Web console login/logout/session — publicly accessible (login issues cookie).
apiRouter.use('/auth/web', webAuthRouter);

// Version info — public (no secrets, surfaced in admin footer).
apiRouter.get('/version', (_req, res) => {
  res.json(VERSION_INFO);
});

// Demo management — public but env-gated (demo/development only).
apiRouter.use('/demo', demoRouter);

apiRouter.use(authMiddleware);

// Identity helper for LIFF clients — returns the authenticated employee.
apiRouter.get('/me', (req, res) => {
  res.json({
    id: req.employee.id,
    employeeId: req.employee.employeeId,
    name: req.employee.name,
    role: req.employee.role,
  });
});

apiRouter.use('/employees', employeeRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/visit-logs', visitLogRouter);
apiRouter.use('/suppliers', supplierRouter);
// ── 模組級 feature gate ──────────────────────────────
apiRouter.use('/quotations', requireModule('sales'), quotationRouter);
apiRouter.use('/sales-orders', requireModule('sales'), salesOrderRouter);
apiRouter.use('/commission', requireModule('sales'), commissionRouter);
apiRouter.use('/purchase-orders', requireModule('purchase'), purchaseOrderRouter);
apiRouter.use('/receivables', requireModule('accounting'), receivableRouter);
apiRouter.use('/payables', requireModule('accounting'), payableRouter);
apiRouter.use('/einvoices', requireModule('accounting'), einvoiceRouter);
apiRouter.use('/einvoice-number-pools', requireModule('accounting'), einvoicePoolRouter);
apiRouter.use('/einvoice-allowances', requireModule('accounting'), allowanceRouter);
apiRouter.use('/accounting', requireModule('accounting'), accountingRouter);
apiRouter.use('/inventory', requireModule('inventory'), inventoryRouter);
apiRouter.use('/refurbish-orders', requireModule('inventory'), refurbishRouter);
apiRouter.use('/machine-records', machineRecordRouter);
apiRouter.use('/statements', statementsRouter);
apiRouter.use('/audit-logs', auditLogRouter);
apiRouter.use('/error-logs', errorLogRouter);
apiRouter.use('/tenant', tenantRouter);
apiRouter.use('/versions', versionRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/billing', advancedBillingRouter); // P0-3c: Advanced billing features
apiRouter.use('/tenant/features', featureRouter);
