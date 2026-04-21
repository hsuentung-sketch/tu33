/**
 * Import historical sales / purchase records from an Excel workbook, and
 * auto-generate AR / AP rows from them.
 *
 * Usage:
 *   npx tsx src/tools/import-transactions.ts <tenantId> <path-to-xlsx> [--confirm]
 *
 * Assumptions (per user decision 2026-04-21):
 *   - Purchase sheet has no 數量 column → derive qty = round(金額 / 單價)
 *   - Existing masters: upsert (customers/suppliers auto-created if missing)
 *   - Skip non-standard order numbers (e.g. "補單", blank)
 *   - Skip 員工清單 and 報價單追蹤
 *   - AR/AP all unpaid by default
 *   - taxAmount = 0, totalAmount = subtotal (Excel 金額 already reconciled)
 *
 * Expected sheets:
 *   - 銷貨紀錄   columns: 公司, 品項, 數量, 單價, 金額, 銷貨單編號, 開單日期, 送貨日期
 *   - 進貨紀錄   columns: 公司, 品項, 單價, 金額, 進貨單編號, 開單日期, 收貨日期
 */
import 'dotenv/config';
import ExcelJS from 'exceljs';
import { endOfMonth, addMonths, startOfMonth } from 'date-fns';
import { prisma as db } from '../shared/prisma.js';

interface Stat {
  ordersCreated: number;
  itemsCreated: number;
  arApCreated: number;
  customersAutoCreated: number;
  suppliersAutoCreated: number;
  rowsSkipped: number;
  ordersSkipped: number;
}

const EXCEL_SALES_PERSON = '董旭恩';
const EXCEL_INTERNAL_STAFF = '葉聖蘭';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function ymdTaipei(d: Date): string {
  const tp = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${tp.getUTCFullYear()}${pad(tp.getUTCMonth() + 1)}${pad(tp.getUTCDate())}`;
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v && 'text' in v) v = (v as { text: string }).text;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object' && v && 'text' in v) return String((v as { text: string }).text).trim() || null;
  if (v instanceof Date) return null;
  const s = String(v).trim();
  return s || null;
}

function toNumber(v: unknown): number | null {
  const t = toText(v);
  if (t == null) return null;
  const n = Number(t.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isValidOrderNo(s: string | null): boolean {
  if (!s) return false;
  // Skip non-numeric / manual tags like "補單", "補"
  return /^\d{8,}/.test(s);
}

function computeDueDate(orderDate: Date, paymentDays: number): Date {
  // dueDate = EOMONTH(firstOfMonth(orderDate) + months=floor(paymentDays/30))
  const monthsOffset = Math.max(0, Math.round(paymentDays / 30));
  return endOfMonth(addMonths(startOfMonth(orderDate), monthsOffset));
}

function billingFromDate(d: Date): { year: number; month: number } {
  const tp = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return { year: tp.getUTCFullYear(), month: tp.getUTCMonth() + 1 };
}

interface SalesRow {
  company: string;
  product: string;
  qty: number;
  unitPrice: number;
  amount: number;
  orderNo: string;
  orderDate: Date;
  deliveryDate: Date | null;
}

interface PurchaseRow {
  company: string;
  product: string;
  qty: number;
  unitPrice: number;
  amount: number;
  orderNo: string;
  orderDate: Date;
  receivedDate: Date | null;
}

async function ensureCustomer(tenantId: string, name: string, stat: Stat): Promise<string | null> {
  const cleaned = name.trim();
  if (!cleaned) return null;
  const existing = await db.customer.findUnique({
    where: { tenantId_name: { tenantId, name: cleaned } },
  });
  if (existing) return existing.id;
  const c = await db.customer.create({
    data: {
      tenantId,
      name: cleaned,
      paymentDays: 30,
    },
  });
  stat.customersAutoCreated++;
  return c.id;
}

async function ensureSupplier(tenantId: string, name: string, stat: Stat): Promise<string | null> {
  const cleaned = name.trim();
  if (!cleaned) return null;
  const existing = await db.supplier.findUnique({
    where: { tenantId_name: { tenantId, name: cleaned } },
  });
  if (existing) return existing.id;
  const s = await db.supplier.create({
    data: {
      tenantId,
      name: cleaned,
      paymentDays: 60,
    },
  });
  stat.suppliersAutoCreated++;
  return s.id;
}

function findSheet(wb: ExcelJS.Workbook, names: string[]): ExcelJS.Worksheet | undefined {
  for (const n of names) {
    const ws = wb.getWorksheet(n);
    if (ws) return ws;
  }
  return undefined;
}

function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const m = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = String(cell.value ?? '').trim();
    if (k) m.set(k, col);
  });
  return m;
}

async function readSalesRows(ws: ExcelJS.Worksheet, stat: Stat): Promise<SalesRow[]> {
  const h = headerMap(ws);
  const cCompany = h.get('公司')!;
  const cProduct = h.get('品項')!;
  const cQty = h.get('數量')!;
  const cUnit = h.get('單價')!;
  const cAmount = h.get('金額')!;
  const cOrderNo = h.get('銷貨單編號')!;
  const cOrderDate = h.get('開單日期')!;
  const cDelivery = h.get('送貨日期');

  const rows: SalesRow[] = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const company = toText(row.getCell(cCompany).value);
    const product = toText(row.getCell(cProduct).value);
    const qty = toNumber(row.getCell(cQty).value);
    const unit = toNumber(row.getCell(cUnit).value);
    const amount = toNumber(row.getCell(cAmount).value);
    const orderNo = toText(row.getCell(cOrderNo).value);
    const orderDate = toDate(row.getCell(cOrderDate).value);
    const delivery = cDelivery ? toDate(row.getCell(cDelivery).value) : null;

    if (!company || !product || qty == null || unit == null || amount == null || !orderDate || !isValidOrderNo(orderNo)) {
      if (company || product) stat.rowsSkipped++;
      continue;
    }
    rows.push({
      company, product, qty, unitPrice: unit, amount,
      orderNo: orderNo!, orderDate, deliveryDate: delivery,
    });
  }
  return rows;
}

async function readPurchaseRows(ws: ExcelJS.Worksheet, stat: Stat): Promise<PurchaseRow[]> {
  const h = headerMap(ws);
  const cCompany = h.get('公司')!;
  const cProduct = h.get('品項')!;
  const cUnit = h.get('單價')!;
  const cAmount = h.get('金額')!;
  const cOrderNo = h.get('進貨單編號')!;
  const cOrderDate = h.get('開單日期')!;
  const cReceived = h.get('收貨日期');

  const rows: PurchaseRow[] = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const company = toText(row.getCell(cCompany).value);
    const product = toText(row.getCell(cProduct).value);
    const unit = toNumber(row.getCell(cUnit).value);
    const amount = toNumber(row.getCell(cAmount).value);
    const orderNo = toText(row.getCell(cOrderNo).value);
    const orderDate = toDate(row.getCell(cOrderDate).value);
    const received = cReceived ? toDate(row.getCell(cReceived).value) : null;

    if (!company || !product || unit == null || amount == null || !orderDate || !isValidOrderNo(orderNo)) {
      if (company || product) stat.rowsSkipped++;
      continue;
    }
    // Derive qty = round(amount / unit)
    const qty = unit > 0 ? Math.max(1, Math.round(amount / unit)) : 1;
    rows.push({
      company, product, qty, unitPrice: unit, amount,
      orderNo: orderNo!, orderDate, receivedDate: received,
    });
  }
  return rows;
}

function groupBy<T, K extends string>(arr: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of arr) {
    const k = key(x);
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  }
  return m;
}

async function importSales(tenantId: string, ws: ExcelJS.Worksheet, createdBy: string, stat: Stat) {
  const rows = await readSalesRows(ws, stat);
  const groups = groupBy(rows, (r) => r.orderNo);
  console.log(`[sales] parsed ${rows.length} rows → ${groups.size} orders`);

  for (const [orderNo, items] of groups) {
    // Skip if this order already exists
    const exists = await db.salesOrder.findUnique({
      where: { tenantId_orderNo: { tenantId, orderNo } },
    });
    if (exists) {
      stat.ordersSkipped++;
      continue;
    }
    const customerName = items[0].company;
    const customerId = await ensureCustomer(tenantId, customerName, stat);
    if (!customerId) {
      stat.ordersSkipped++;
      continue;
    }
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    const paymentDays = customer?.paymentDays ?? 30;

    const orderDate = items.reduce((min, r) => (r.orderDate < min ? r.orderDate : min), items[0].orderDate);
    const deliveryDate = items.reduce<Date | null>((d, r) => {
      if (!r.deliveryDate) return d;
      if (!d || r.deliveryDate > d) return r.deliveryDate;
      return d;
    }, null);
    const subtotal = items.reduce((s, r) => s + r.amount, 0);

    const order = await db.salesOrder.create({
      data: {
        tenantId,
        orderNo,
        customerId,
        salesPerson: EXCEL_SALES_PERSON,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        status: deliveryDate ? 'DELIVERED' : 'PENDING',
        orderDate,
        deliveryDate,
        createdBy,
        items: {
          create: items.map((it, idx) => ({
            productName: it.product,
            quantity: it.qty,
            unitPrice: it.unitPrice,
            amount: it.amount,
            sortOrder: idx,
          })),
        },
      },
    });
    stat.ordersCreated++;
    stat.itemsCreated += items.length;

    const { year, month } = billingFromDate(orderDate);
    await db.accountReceivable.create({
      data: {
        tenantId,
        customerId,
        salesOrderId: order.id,
        billingYear: year,
        billingMonth: month,
        amount: subtotal,
        dueDate: computeDueDate(orderDate, paymentDays),
        isPaid: false,
      },
    });
    stat.arApCreated++;
  }
}

async function importPurchases(tenantId: string, ws: ExcelJS.Worksheet, createdBy: string, stat: Stat) {
  const rows = await readPurchaseRows(ws, stat);
  const groups = groupBy(rows, (r) => r.orderNo);
  console.log(`[purchase] parsed ${rows.length} rows → ${groups.size} orders`);

  for (const [orderNo, items] of groups) {
    const exists = await db.purchaseOrder.findUnique({
      where: { tenantId_orderNo: { tenantId, orderNo } },
    });
    if (exists) {
      stat.ordersSkipped++;
      continue;
    }
    const supplierName = items[0].company;
    const supplierId = await ensureSupplier(tenantId, supplierName, stat);
    if (!supplierId) {
      stat.ordersSkipped++;
      continue;
    }
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    const paymentDays = supplier?.paymentDays ?? 60;

    const orderDate = items.reduce((min, r) => (r.orderDate < min ? r.orderDate : min), items[0].orderDate);
    const receivedDate = items.reduce<Date | null>((d, r) => {
      if (!r.receivedDate) return d;
      if (!d || r.receivedDate > d) return r.receivedDate;
      return d;
    }, null);
    const subtotal = items.reduce((s, r) => s + r.amount, 0);

    const order = await db.purchaseOrder.create({
      data: {
        tenantId,
        orderNo,
        supplierId,
        internalStaff: EXCEL_INTERNAL_STAFF,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        status: receivedDate ? 'RECEIVED' : 'PENDING',
        orderDate,
        receivedDate,
        createdBy,
        items: {
          create: items.map((it, idx) => ({
            productName: it.product,
            quantity: it.qty,
            unitPrice: it.unitPrice,
            amount: it.amount,
            sortOrder: idx,
          })),
        },
      },
    });
    stat.ordersCreated++;
    stat.itemsCreated += items.length;

    const { year, month } = billingFromDate(orderDate);
    await db.accountPayable.create({
      data: {
        tenantId,
        supplierId,
        purchaseOrderId: order.id,
        billingYear: year,
        billingMonth: month,
        amount: subtotal,
        dueDate: computeDueDate(orderDate, paymentDays),
        isPaid: false,
      },
    });
    stat.arApCreated++;
  }
}

async function main() {
  const [, , tenantId, filePath, ...flags] = process.argv;
  if (!tenantId || !filePath) {
    console.error('Usage: npx tsx src/tools/import-transactions.ts <tenantId> <path-to-xlsx> [--confirm]');
    process.exit(1);
  }
  if (!flags.includes('--confirm')) {
    console.error('Refusing to run without --confirm. Append --confirm to proceed.');
    process.exit(1);
  }

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  // Use first ADMIN as createdBy
  const admin = await db.employee.findFirst({
    where: { tenantId, role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new Error('No ADMIN employee found for tenant');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const stat: Stat = {
    ordersCreated: 0,
    itemsCreated: 0,
    arApCreated: 0,
    customersAutoCreated: 0,
    suppliersAutoCreated: 0,
    rowsSkipped: 0,
    ordersSkipped: 0,
  };

  const salesSheet = findSheet(wb, ['銷貨紀錄']);
  if (salesSheet) {
    console.log('--- Sales ---');
    await importSales(tenantId, salesSheet, admin.id, stat);
  }

  const purchaseSheet = findSheet(wb, ['進貨紀錄']);
  if (purchaseSheet) {
    console.log('--- Purchase ---');
    await importPurchases(tenantId, purchaseSheet, admin.id, stat);
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(stat, null, 2));

  const counts = {
    salesOrders: await db.salesOrder.count({ where: { tenantId } }),
    purchaseOrders: await db.purchaseOrder.count({ where: { tenantId } }),
    ar: await db.accountReceivable.count({ where: { tenantId } }),
    ap: await db.accountPayable.count({ where: { tenantId } }),
    customers: await db.customer.count({ where: { tenantId } }),
    suppliers: await db.supplier.count({ where: { tenantId } }),
  };
  console.log('DB counts after import:', counts);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
