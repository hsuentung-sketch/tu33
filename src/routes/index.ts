import { Router } from 'express';
import { authMiddleware } from '../modules/core/auth/auth.middleware.js';
import { authRouter } from '../modules/core/auth/auth.router.js';
import { webAuthRouter } from '../modules/core/auth/web-auth.router.js';
import { employeeRouter } from '../modules/core/employee/employee.router.js';
import { productRouter } from '../modules/master/product/product.router.js';
import { customerRouter } from '../modules/master/customer/customer.router.js';
import { supplierRouter } from '../modules/master/supplier/supplier.router.js';
import { quotationRouter } from '../modules/sales/quotation/quotation.router.js';
import { salesOrderRouter } from '../modules/sales/sales-order/sales-order.router.js';
import { purchaseOrderRouter } from '../modules/purchase/purchase-order/purchase-order.router.js';
import { receivableRouter } from '../modules/accounting/receivable/receivable.router.js';
import { payableRouter } from '../modules/accounting/payable/payable.router.js';
import { inventoryRouter } from '../modules/inventory/inventory.router.js';
import { statementsRouter } from './statements.router.js';
import { auditLogRouter } from '../modules/core/audit-log/audit-log.router.js';
import { errorLogRouter } from '../modules/core/error-log/error-log.router.js';
import { tenantRouter } from '../modules/core/tenant/tenant.router.js';
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
apiRouter.use('/suppliers', supplierRouter);
apiRouter.use('/quotations', quotationRouter);
apiRouter.use('/sales-orders', salesOrderRouter);
apiRouter.use('/purchase-orders', purchaseOrderRouter);
apiRouter.use('/receivables', receivableRouter);
apiRouter.use('/payables', payableRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/statements', statementsRouter);
apiRouter.use('/audit-logs', auditLogRouter);
apiRouter.use('/error-logs', errorLogRouter);
apiRouter.use('/tenant', tenantRouter);
