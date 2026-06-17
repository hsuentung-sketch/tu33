/**
 * Seed comprehensive test data for Admin UI testing.
 * 1. Unlocks all modules on the test tenant
 * 2. Creates 20+ products (mixed categories)
 * 3. Creates 20 customers (varied priceTiers)
 * 4. Creates 5 suppliers
 * 5. Creates 10 quotations with items
 * 6. Creates 10 sales orders with items → 10 AR records
 * 7. Creates 5 purchase orders with items → 5 AP records
 * 8. Creates 10 machine records with warranty
 * 9. Creates 3 refurbish orders with items
 * 10. Creates 10 inventory transactions
 *
 * Usage: npx tsx src/tools/_seed-test-data.ts
 */
import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

const TENANT_NAME = 'Test Agri Co';

const PRODUCTS = [
  { code: 'CG411', name: 'CG411 割草機', category: 'NEW_MACHINE', salePrice: 15000, costPrice: 10000, shippingFee: 500, laborFee: 300 },
  { code: 'CG413', name: 'CG413 割草機(自走式)', category: 'NEW_MACHINE', salePrice: 25000, costPrice: 18000, shippingFee: 800, laborFee: 500 },
  { code: 'TB26', name: 'TB26 背負式割草機', category: 'NEW_MACHINE', salePrice: 8500, costPrice: 5500, shippingFee: 300, laborFee: 200 },
  { code: 'GX160', name: 'Honda GX160 引擎', category: 'NEW_MACHINE', salePrice: 12000, costPrice: 8000, shippingFee: 600, laborFee: 400 },
  { code: 'GX200', name: 'Honda GX200 引擎', category: 'NEW_MACHINE', salePrice: 14000, costPrice: 9500, shippingFee: 600, laborFee: 400 },
  { code: 'KT17', name: 'Kawasaki KT17 引擎', category: 'NEW_MACHINE', salePrice: 18000, costPrice: 12000, shippingFee: 700, laborFee: 500 },
  { code: 'SP-AIR', name: '空氣濾清器', category: 'PART', salePrice: 120, costPrice: 60 },
  { code: 'SP-OIL', name: '機油濾清器', category: 'PART', salePrice: 80, costPrice: 35 },
  { code: 'SP-BELT', name: '皮帶 A-32', category: 'PART', salePrice: 250, costPrice: 120 },
  { code: 'SP-BLADE', name: '割草刀片 18吋', category: 'PART', salePrice: 350, costPrice: 180 },
  { code: 'SP-PLUG', name: '火星塞 NGK BPR6ES', category: 'PART', salePrice: 60, costPrice: 25 },
  { code: 'SP-CARB', name: '化油器總成', category: 'PART', salePrice: 1200, costPrice: 600 },
  { code: 'SP-COIL', name: '點火線圈', category: 'PART', salePrice: 800, costPrice: 350 },
  { code: 'SP-GEAR', name: '齒輪箱總成', category: 'PART', salePrice: 2500, costPrice: 1200 },
  { code: 'SP-LINE', name: '牛筋繩 3mm (100m)', category: 'PART', salePrice: 450, costPrice: 200 },
  { code: 'SP-FUEL', name: '油管總成', category: 'PART', salePrice: 180, costPrice: 80 },
  { code: 'UM-CG01', name: '二手 CG411 割草機 (2024)', category: 'USED_MACHINE', salePrice: 8000, costPrice: 5000, purchaseCost: 4000 },
  { code: 'UM-TB01', name: '二手 TB26 背負式 (2023)', category: 'USED_MACHINE', salePrice: 4500, costPrice: 2800, purchaseCost: 2000 },
  { code: 'UM-GX01', name: '二手 GX160 引擎 (2024)', category: 'USED_MACHINE', salePrice: 6000, costPrice: 3500, purchaseCost: 2500 },
  { code: 'SVC-TUNE', name: '引擎調校服務', category: 'SERVICE', salePrice: 800, costPrice: 0 },
  { code: 'SVC-OVER', name: '引擎大修服務', category: 'SERVICE', salePrice: 3500, costPrice: 0 },
  { code: 'SVC-MAINT', name: '定期保養服務', category: 'SERVICE', salePrice: 500, costPrice: 0 },
];

const CUSTOMERS = [
  { name: '大豐農機行', priceTier: 1, paymentDays: 30, phone: '04-2345-6789' },
  { name: '永盛農機', priceTier: 2, paymentDays: 30, phone: '04-2567-8901' },
  { name: '金山農機行', priceTier: 1, paymentDays: 15, phone: '037-123-456' },
  { name: '信義農機', priceTier: 3, paymentDays: 45, phone: '049-234-5678' },
  { name: '嘉南農機', priceTier: 2, paymentDays: 30, phone: '05-345-6789' },
  { name: '東港農機行', priceTier: 4, paymentDays: 60, phone: '08-456-7890' },
  { name: '宜蘭農具店', priceTier: 1, paymentDays: 15, phone: '03-567-8901' },
  { name: '花蓮農業資材', priceTier: 3, paymentDays: 30, phone: '03-678-9012' },
  { name: '台東農機中心', priceTier: 2, paymentDays: 30, phone: '089-789-012' },
  { name: '彰化五金農機', priceTier: 5, paymentDays: 90, phone: '04-890-1234' },
  { name: '雲林農機行', priceTier: 1, paymentDays: 30, phone: '05-901-2345' },
  { name: '屏東田園農機', priceTier: 2, paymentDays: 30, phone: '08-012-3456' },
  { name: '苗栗國興農機', priceTier: 3, paymentDays: 45, phone: '037-234-567' },
  { name: '南投青山農具', priceTier: 1, paymentDays: 15, phone: '049-345-6789' },
  { name: '高雄大發農機', priceTier: 4, paymentDays: 60, phone: '07-456-7890' },
  { name: '台南永康農機', priceTier: 2, paymentDays: 30, phone: '06-567-8901' },
  { name: '桃園農機材料行', priceTier: 1, paymentDays: 15, phone: '03-678-9012' },
  { name: '新竹光復農機', priceTier: 3, paymentDays: 45, phone: '03-789-0123' },
  { name: '基隆港都農機', priceTier: 2, paymentDays: 30, phone: '02-890-1234' },
  { name: '澎湖漁農機械', priceTier: 1, paymentDays: 15, phone: '06-901-2345' },
];

const SUPPLIERS = [
  { name: 'Honda Taiwan', contactName: '陳經理', phone: '02-1234-5678' },
  { name: 'Kawasaki 台灣代理', contactName: '林先生', phone: '02-2345-6789' },
  { name: '三菱農機台灣', contactName: '王小姐', phone: '04-3456-7890' },
  { name: '台中五金零件批發', contactName: '張老闆', phone: '04-4567-8901' },
  { name: '高雄機械零件行', contactName: '李經理', phone: '07-5678-9012' },
];

async function seed() {
  // 1. Find and update tenant
  const tenant = await db.tenant.findFirst({ where: { companyName: TENANT_NAME } });
  if (!tenant) throw new Error(`Tenant "${TENANT_NAME}" not found. Run _test-bootstrap.ts first.`);
  const tid = tenant.id;

  await db.tenant.update({
    where: { id: tid },
    data: {
      modules: ['sales', 'purchase', 'accounting', 'inventory', 'customers', 'suppliers', 'machine-record', 'refurbish-order'],
      settings: { einvoice: { enabled: true } },
    },
  });
  console.log('1. Tenant modules unlocked (all)');

  // 2. Products
  const products: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const existing = await db.product.findUnique({ where: { tenantId_code: { tenantId: tid, code: p.code } } });
    if (existing) {
      products[p.code] = existing.id;
      continue;
    }
    const created = await db.product.create({
      data: {
        tenantId: tid, code: p.code, name: p.name, category: p.category,
        salePrice: p.salePrice, costPrice: p.costPrice,
        shippingFee: p.shippingFee ?? 0, laborFee: p.laborFee ?? 0,
        purchaseCost: p.purchaseCost,
      },
    });
    products[p.code] = created.id;
  }
  console.log(`2. Products: ${Object.keys(products).length} ready`);

  // 3. Customers
  const customers: Array<{ id: string; name: string }> = [];
  for (const c of CUSTOMERS) {
    const existing = await db.customer.findUnique({ where: { tenantId_name: { tenantId: tid, name: c.name } } });
    if (existing) { customers.push({ id: existing.id, name: existing.name }); continue; }
    const created = await db.customer.create({
      data: { tenantId: tid, name: c.name, priceTier: c.priceTier, paymentDays: c.paymentDays, phone: c.phone },
    });
    customers.push({ id: created.id, name: created.name });
  }
  console.log(`3. Customers: ${customers.length} ready`);

  // 4. Suppliers
  const suppliers: Array<{ id: string; name: string }> = [];
  for (const s of SUPPLIERS) {
    const existing = await db.supplier.findUnique({ where: { tenantId_name: { tenantId: tid, name: s.name } } });
    if (existing) { suppliers.push({ id: existing.id, name: existing.name }); continue; }
    const created = await db.supplier.create({
      data: { tenantId: tid, name: s.name, contactName: s.contactName, phone: s.phone },
    });
    suppliers.push({ id: created.id, name: created.name });
  }
  console.log(`4. Suppliers: ${suppliers.length} ready`);

  // 5. Quotations (10)
  let qCount = 0;
  for (let i = 1; i <= 10; i++) {
    const qNo = `Q-2026-${String(i).padStart(4, '0')}`;
    const existing = await db.quotation.findFirst({ where: { tenantId: tid, quotationNo: qNo } });
    if (existing) { qCount++; continue; }
    const cust = customers[i % customers.length];
    const p1 = PRODUCTS[i % 6]; // machines
    const p2 = PRODUCTS[6 + (i % 10)]; // parts
    const amt1 = p1.salePrice * (i % 3 + 1);
    const amt2 = p2.salePrice * (i % 5 + 1);
    const subtotal = amt1 + amt2;
    const tax = Math.round(subtotal * 0.05);
    const statuses: Array<'DRAFT' | 'SENT' | 'TRACKING' | 'WON' | 'LOST'> = ['DRAFT', 'SENT', 'TRACKING', 'WON', 'LOST'];
    await db.quotation.create({
      data: {
        tenantId: tid, quotationNo: qNo, customerId: cust.id,
        salesPerson: 'Admin', subtotal, taxAmount: tax, totalAmount: subtotal + tax,
        createdBy: 'seed', status: statuses[i % statuses.length],
        items: {
          create: [
            { productName: p1.name, quantity: i % 3 + 1, unitPrice: p1.salePrice, amount: amt1 },
            { productName: p2.name, quantity: i % 5 + 1, unitPrice: p2.salePrice, amount: amt2 },
          ],
        },
      },
    });
    qCount++;
  }
  console.log(`5. Quotations: ${qCount} ready`);

  // 6. Sales Orders (10) + AR (10)
  let soCount = 0;
  for (let i = 1; i <= 10; i++) {
    const soNo = `SO-2026-${String(i).padStart(4, '0')}`;
    const existing = await db.salesOrder.findFirst({ where: { tenantId: tid, orderNo: soNo } });
    if (existing) { soCount++; continue; }
    const cust = customers[i % customers.length];
    const p1 = PRODUCTS[(i + 2) % 6];
    const p2 = PRODUCTS[6 + ((i + 3) % 10)];
    const q1 = i % 3 + 1;
    const q2 = i % 4 + 2;
    const amt1 = p1.salePrice * q1;
    const amt2 = p2.salePrice * q2;
    const subtotal = amt1 + amt2;
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;
    const statuses: Array<'PENDING' | 'DELIVERED' | 'COMPLETED'> = ['PENDING', 'DELIVERED', 'COMPLETED'];
    const so = await db.salesOrder.create({
      data: {
        tenantId: tid, orderNo: soNo, customerId: cust.id,
        salesPerson: 'Admin', subtotal, taxAmount: tax, totalAmount: total,
        createdBy: 'seed', status: statuses[i % statuses.length],
        items: {
          create: [
            { productName: p1.name, quantity: q1, unitPrice: p1.salePrice, amount: amt1 },
            { productName: p2.name, quantity: q2, unitPrice: p2.salePrice, amount: amt2 },
          ],
        },
      },
    });
    // Create AR for each sales order
    const invoiceTypes = [null, 'RECEIPT', 'TAX_INVOICE'];
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (cust.name === '測試農機行' ? 30 : CUSTOMERS.find(c => c.name === cust.name)?.paymentDays ?? 30));
    await db.accountReceivable.create({
      data: {
        tenantId: tid, customerId: cust.id, salesOrderId: so.id,
        billingYear: 2026, billingMonth: 6, amount: total, dueDate,
        invoiceType: invoiceTypes[i % 3],
        isPaid: i <= 3,
        paidDate: i <= 3 ? new Date() : null,
      },
    });
    soCount++;
  }
  console.log(`6. Sales Orders + AR: ${soCount} ready`);

  // 7. Purchase Orders (5) + AP (5)
  let poCount = 0;
  for (let i = 1; i <= 5; i++) {
    const poNo = `PO-2026-${String(i).padStart(4, '0')}`;
    const existing = await db.purchaseOrder.findFirst({ where: { tenantId: tid, orderNo: poNo } });
    if (existing) { poCount++; continue; }
    const sup = suppliers[i % suppliers.length];
    const p1 = PRODUCTS[(i * 2) % 6];
    const p2 = PRODUCTS[6 + (i % 10)];
    const q1 = (i + 1) * 5;
    const q2 = (i + 2) * 3;
    const amt1 = p1.costPrice * q1;
    const amt2 = p2.costPrice * q2;
    const subtotal = amt1 + amt2;
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;
    const po = await db.purchaseOrder.create({
      data: {
        tenantId: tid, orderNo: poNo, supplierId: sup.id,
        internalStaff: 'Admin', subtotal, taxAmount: tax, totalAmount: total,
        createdBy: 'seed', status: i <= 2 ? 'PENDING' : i <= 4 ? 'RECEIVED' : 'COMPLETED',
        items: {
          create: [
            { productName: p1.name, quantity: q1, unitPrice: p1.costPrice, amount: amt1 },
            { productName: p2.name, quantity: q2, unitPrice: p2.costPrice, amount: amt2 },
          ],
        },
      },
    });
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    await db.accountPayable.create({
      data: {
        tenantId: tid, supplierId: sup.id, purchaseOrderId: po.id,
        billingYear: 2026, billingMonth: 6, amount: total, dueDate,
        isPaid: i > 2,
        paidDate: i > 2 ? new Date() : null,
      },
    });
    poCount++;
  }
  console.log(`7. Purchase Orders + AP: ${poCount} ready`);

  // 8. Machine Records (10)
  const machineProducts = PRODUCTS.filter(p => p.category === 'NEW_MACHINE');
  let mrCount = 0;
  for (let i = 1; i <= 10; i++) {
    const mp = machineProducts[i % machineProducts.length];
    const serial = `${mp.code}-2026-${String(i).padStart(3, '0')}`;
    const existing = await db.machineRecord.findUnique({
      where: { tenantId_serialNumber: { tenantId: tid, serialNumber: serial } },
    });
    if (existing) { mrCount++; continue; }
    const startDate = new Date('2026-01-01');
    startDate.setMonth(startDate.getMonth() + (i % 6));
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    await db.machineRecord.create({
      data: {
        tenantId: tid, productId: products[mp.code], serialNumber: serial,
        warrantyStartAt: startDate, warrantyEndAt: endDate, registeredBy: 'seed',
      },
    });
    mrCount++;
  }
  console.log(`8. Machine Records: ${mrCount} ready`);

  // 9. Refurbish Orders (3)
  const usedMachines = PRODUCTS.filter(p => p.category === 'USED_MACHINE');
  let rfCount = 0;
  for (let i = 0; i < 3; i++) {
    const um = usedMachines[i % usedMachines.length];
    const existing = await db.refurbishOrder.findFirst({
      where: { tenantId: tid, usedMachine: { code: um.code } },
    });
    if (existing) { rfCount++; continue; }
    const parts = PRODUCTS.filter(p => p.category === 'PART').slice(i * 2, i * 2 + 3);
    const totalCost = parts.reduce((sum, p) => sum + p.costPrice, 0);
    const statuses = ['IN_PROGRESS', 'COMPLETED', 'IN_PROGRESS'];
    await db.refurbishOrder.create({
      data: {
        tenantId: tid, usedMachineId: products[um.code],
        createdBy: 'seed', status: statuses[i], totalCost,
        note: `整備 ${um.name}`,
        items: {
          create: parts.map(p => ({
            productId: products[p.code],
            quantity: i + 1,
            unitCost: p.costPrice,
          })),
        },
      },
    });
    rfCount++;
  }
  console.log(`9. Refurbish Orders: ${rfCount} ready`);

  // 10. Inventory Transactions (10)
  const reasons: Array<'PURCHASE_IN' | 'SALES_OUT' | 'ADJUSTMENT' | 'INITIAL' | 'REFURBISH_OUT'> =
    ['PURCHASE_IN', 'SALES_OUT', 'ADJUSTMENT', 'INITIAL', 'REFURBISH_OUT'];
  let invCount = 0;
  const partCodes = PRODUCTS.filter(p => p.category === 'PART').map(p => p.code);
  for (let i = 0; i < 10; i++) {
    const code = partCodes[i % partCodes.length];
    const reason = reasons[i % reasons.length];
    const delta = reason === 'SALES_OUT' || reason === 'REFURBISH_OUT' ? -(i + 1) : (i + 1) * 10;
    await db.inventoryTransaction.create({
      data: {
        tenantId: tid, productId: products[code],
        delta, reason,
        note: `seed data #${i + 1}`,
      },
    });
    invCount++;
  }
  console.log(`10. Inventory Transactions: ${invCount} ready`);

  console.log('\n=== SEED COMPLETE ===');
  console.log('Login: http://localhost:3000/admin/login.html');
  console.log('Account: ADMIN / test1234');
}

seed()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => db.$disconnect());
