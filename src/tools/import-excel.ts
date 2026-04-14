/**
 * Batch import products / customers / suppliers from an Excel workbook.
 *
 * Usage:
 *   tsx src/tools/import-excel.ts <tenantId> <path-to-xlsx>
 *
 * Expected sheet names (all optional — only present sheets are imported):
 *   - 產品清單     columns: 編號, 產品名稱, 類別, 售價, 進價, 備註
 *   - 客戶清單     columns: 公司, 聯絡人, 統編, 電話, 郵遞區號, 地址, 付款天數
 *   - 供應商清單   columns: 供應商, 類型, 聯絡人, 統編, 電話, 郵遞區號, 地址, 付款天數
 */
import ExcelJS from 'exceljs';
import { prisma as db } from '../shared/prisma.js';

interface ImportResult {
  products: { created: number; updated: number; skipped: number };
  customers: { created: number; updated: number; skipped: number };
  suppliers: { created: number; updated: number; skipped: number };
}

export async function importExcel(tenantId: string, filePath: string): Promise<ImportResult> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const result: ImportResult = {
    products: { created: 0, updated: 0, skipped: 0 },
    customers: { created: 0, updated: 0, skipped: 0 },
    suppliers: { created: 0, updated: 0, skipped: 0 },
  };

  const productSheet = findSheet(wb, ['產品清單', 'Products']);
  if (productSheet) await importProducts(tenantId, productSheet, result);

  const customerSheet = findSheet(wb, ['客戶清單', 'Customers']);
  if (customerSheet) await importCustomers(tenantId, customerSheet, result);

  const supplierSheet = findSheet(wb, ['供應商清單', 'Suppliers']);
  if (supplierSheet) await importSuppliers(tenantId, supplierSheet, result);

  return result;
}

function findSheet(wb: ExcelJS.Workbook, names: string[]): ExcelJS.Worksheet | undefined {
  for (const n of names) {
    const ws = wb.getWorksheet(n);
    if (ws) return ws;
  }
  return undefined;
}

function readHeaderMap(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  const header = sheet.getRow(1);
  header.eachCell((cell, colNumber) => {
    const key = String(cell.value ?? '').trim();
    if (key) map.set(key, colNumber);
  });
  return map;
}

function cellText(row: ExcelJS.Row, col: number | undefined): string | null {
  if (!col) return null;
  const v = row.getCell(col).value;
  if (v == null) return null;
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim() || null;
  return String(v).trim() || null;
}

function cellNumber(row: ExcelJS.Row, col: number | undefined): number | null {
  const t = cellText(row, col);
  if (t == null) return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function importProducts(
  tenantId: string,
  sheet: ExcelJS.Worksheet,
  result: ImportResult,
): Promise<void> {
  const h = readHeaderMap(sheet);
  const cCode = h.get('編號') ?? h.get('code');
  const cName = h.get('產品名稱') ?? h.get('name');
  const cCategory = h.get('類別') ?? h.get('category');
  const cSale = h.get('售價') ?? h.get('salePrice');
  const cCost = h.get('進價') ?? h.get('costPrice');
  const cNote = h.get('備註') ?? h.get('note');

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const code = cellText(row, cCode);
    const name = cellText(row, cName);
    if (!code || !name) {
      result.products.skipped++;
      continue;
    }
    const existing = await db.product.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    const data = {
      tenantId,
      code,
      name,
      category: cellText(row, cCategory),
      salePrice: cellNumber(row, cSale) ?? 0,
      costPrice: cellNumber(row, cCost) ?? 0,
      note: cellText(row, cNote),
    };
    if (existing) {
      await db.product.update({ where: { id: existing.id }, data });
      result.products.updated++;
    } else {
      await db.product.create({ data });
      result.products.created++;
    }
  }
}

async function importCustomers(
  tenantId: string,
  sheet: ExcelJS.Worksheet,
  result: ImportResult,
): Promise<void> {
  const h = readHeaderMap(sheet);
  const cName = h.get('公司') ?? h.get('name');
  const cContact = h.get('聯絡人') ?? h.get('contactName');
  const cTaxId = h.get('統編') ?? h.get('統一編號') ?? h.get('taxId');
  const cPhone = h.get('電話') ?? h.get('phone');
  const cZip = h.get('郵遞區號') ?? h.get('zipCode');
  const cAddr = h.get('地址') ?? h.get('address');
  const cDays = h.get('付款天數') ?? h.get('paymentDays');

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const name = cellText(row, cName);
    if (!name) {
      result.customers.skipped++;
      continue;
    }
    const existing = await db.customer.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    const data = {
      tenantId,
      name,
      contactName: cellText(row, cContact),
      taxId: cellText(row, cTaxId),
      phone: cellText(row, cPhone),
      zipCode: cellText(row, cZip),
      address: cellText(row, cAddr),
      paymentDays: cellNumber(row, cDays) ?? 30,
    };
    if (existing) {
      await db.customer.update({ where: { id: existing.id }, data });
      result.customers.updated++;
    } else {
      await db.customer.create({ data });
      result.customers.created++;
    }
  }
}

async function importSuppliers(
  tenantId: string,
  sheet: ExcelJS.Worksheet,
  result: ImportResult,
): Promise<void> {
  const h = readHeaderMap(sheet);
  const cName = h.get('供應商') ?? h.get('name');
  const cType = h.get('類型') ?? h.get('type');
  const cContact = h.get('聯絡人') ?? h.get('contactName');
  const cTaxId = h.get('統編') ?? h.get('統一編號') ?? h.get('taxId');
  const cPhone = h.get('電話') ?? h.get('phone');
  const cZip = h.get('郵遞區號') ?? h.get('zipCode');
  const cAddr = h.get('地址') ?? h.get('address');
  const cDays = h.get('付款天數') ?? h.get('paymentDays');

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const name = cellText(row, cName);
    if (!name) {
      result.suppliers.skipped++;
      continue;
    }
    const existing = await db.supplier.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    const data = {
      tenantId,
      name,
      type: cellText(row, cType),
      contactName: cellText(row, cContact),
      taxId: cellText(row, cTaxId),
      phone: cellText(row, cPhone),
      zipCode: cellText(row, cZip),
      address: cellText(row, cAddr),
      paymentDays: cellNumber(row, cDays) ?? 60,
    };
    if (existing) {
      await db.supplier.update({ where: { id: existing.id }, data });
      result.suppliers.updated++;
    } else {
      await db.supplier.create({ data });
      result.suppliers.created++;
    }
  }
}

// CLI entry
const [, , tenantId, filePath] = process.argv;
if (!tenantId || !filePath) {
  console.error('Usage: tsx src/tools/import-excel.ts <tenantId> <path-to-xlsx>');
  process.exit(1);
}

importExcel(tenantId, filePath)
  .then((r) => {
    console.log('Import complete:');
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
