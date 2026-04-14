import { Router } from 'express';
import { authMiddleware } from '../modules/core/auth/auth.middleware.js';
import { employeeRouter } from '../modules/core/employee/employee.router.js';
import { productRouter } from '../modules/master/product/product.router.js';
import { customerRouter } from '../modules/master/customer/customer.router.js';
import { supplierRouter } from '../modules/master/supplier/supplier.router.js';
import { quotationRouter } from '../modules/sales/quotation/quotation.router.js';
import { salesOrderRouter } from '../modules/sales/sales-order/sales-order.router.js';
import { purchaseOrderRouter } from '../modules/purchase/purchase-order/purchase-order.router.js';
import { receivableRouter } from '../modules/accounting/receivable/receivable.router.js';
import { payableRouter } from '../modules/accounting/payable/payable.router.js';

export const apiRouter = Router();

apiRouter.use(authMiddleware);

apiRouter.use('/employees', employeeRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/suppliers', supplierRouter);
apiRouter.use('/quotations', quotationRouter);
apiRouter.use('/sales-orders', salesOrderRouter);
apiRouter.use('/purchase-orders', purchaseOrderRouter);
apiRouter.use('/receivables', receivableRouter);
apiRouter.use('/payables', payableRouter);
