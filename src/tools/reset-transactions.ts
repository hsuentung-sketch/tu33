/**
 * Reset transactional data — keep tenant / employees / master tables.
 *
 * Deletes in FK-safe order:
 *   InventoryTransaction → Inventory
 *   QuotationItem → Quotation
 *   SalesOrderItem → SalesOrder
 *   PurchaseOrderItem → PurchaseOrder
 *   AccountReceivable / AccountPayable
 *   ShortLink / AuditLog / ErrorLog
 *
 * Keeps: Tenant, Employee, Product, Customer, Supplier
 *
 * Usage:
 *   npx tsx src/tools/reset-transactions.ts --confirm
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm flag.');
    console.error('Run: npx tsx src/tools/reset-transactions.ts --confirm');
    process.exit(1);
  }

  const before = {
    quotation: await prisma.quotation.count(),
    salesOrder: await prisma.salesOrder.count(),
    purchaseOrder: await prisma.purchaseOrder.count(),
    ar: await prisma.accountReceivable.count(),
    ap: await prisma.accountPayable.count(),
    inventory: await prisma.inventory.count(),
    inventoryTxn: await prisma.inventoryTransaction.count(),
    auditLog: await prisma.auditLog.count(),
    errorLog: await prisma.errorLog.count(),
    shortLink: await prisma.shortLink.count(),
  };
  console.log('Before:', before);

  // Note: we cannot use $transaction here because the pooler connection has
  // a short timeout and delete-by-tenant could be slow. Do it sequentially.
  await prisma.inventoryTransaction.deleteMany({});
  await prisma.inventory.deleteMany({});

  // AR / AP reference SalesOrder / PurchaseOrder, so delete them first.
  await prisma.accountReceivable.deleteMany({});
  await prisma.accountPayable.deleteMany({});

  // Child items have onDelete: Cascade on their parent, so deleting the
  // parent row auto-deletes the items.
  await prisma.quotation.deleteMany({});
  await prisma.salesOrder.deleteMany({});
  await prisma.purchaseOrder.deleteMany({});

  await prisma.shortLink.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.errorLog.deleteMany({});

  const after = {
    tenant: await prisma.tenant.count(),
    employee: await prisma.employee.count(),
    product: await prisma.product.count(),
    customer: await prisma.customer.count(),
    supplier: await prisma.supplier.count(),
    quotation: await prisma.quotation.count(),
    salesOrder: await prisma.salesOrder.count(),
    purchaseOrder: await prisma.purchaseOrder.count(),
    ar: await prisma.accountReceivable.count(),
    ap: await prisma.accountPayable.count(),
    inventory: await prisma.inventory.count(),
    inventoryTxn: await prisma.inventoryTransaction.count(),
    auditLog: await prisma.auditLog.count(),
    errorLog: await prisma.errorLog.count(),
    shortLink: await prisma.shortLink.count(),
  };
  console.log('After:', after);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
