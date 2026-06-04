/**
 * Excel (xlsx) generator for sales orders and purchase orders.
 *
 * Layout mirrors the PDF exactly:
 *   1. Title band（銷貨單 / 進貨單 + 公司名）
 *   2. Info grid: left 6 rows / right 6 rows（與 pdf-generator 完全對應）
 *   3. Item table: 編號 / 品項 / 數量 / 單價 / 金額 / 說明
 *   4. Totals: 小計 / 營業稅(5%) / 總計
 *   5. Signature line（出貨人/收貨人 or 進貨人/出貨人）
 */
import ExcelJS from 'exceljs';

interface ExcelItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string | null;
}

export interface OrderExcelData {
  kind: 'sales' | 'purchase';
  companyHeader: string;
  companyTaxId?: string | null;
  companyAddress?: string | null;
  orderNo: string;
  date: Date;
  // --- party (customer / supplier) ---
  partyName: string;
  partyContactName?: string | null;
  partyTaxId?: string | null;
  partyPhone?: string | null;
  partyAddress?: string | null;
  deliveryNote?: string | null;
  // --- staff ---
  staffName: string;
  staffPhone?: string | null;
  // --- items & totals ---
  items: ExcelItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  // --- signature ---
  deliveredBy?: string | null;
  receivedBy?: string | null;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-TW');
}

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
};

const LABEL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: 'FF333333' } };
const VALUE_FONT: Partial<ExcelJS.Font> = { size: 10 };
const TITLE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE3EE' } };

export async function generateOrderExcel(data: OrderExcelData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const isSales = data.kind === 'sales';
  const title = isSales ? '銷貨單' : '進貨單';
  const partyLabel = isSales ? '公司' : '供應商';
  const staffLabel = isSales ? '業務' : '內勤';
  const orderLabel = isSales ? '訂單編號' : '進貨單號';
  const ws = wb.addWorksheet(title);

  // 12 columns: A-F for left half, G-L for right half (mirrors PDF two-column grid)
  // Item table spans all 12 columns with merge patterns matching PDF proportions
  ws.columns = [
    { width: 8 },   // A: label-left
    { width: 22 },  // B: value-left
    { width: 10 },  // C: value-left cont
    { width: 8 },   // D: label-right
    { width: 15 },  // E: value-right
    { width: 12 },  // F: value-right cont
  ];

  let r = 1;

  // ── 1. Title band ──
  ws.mergeCells(r, 1, r, 6);
  const tc = ws.getCell(r, 1);
  tc.value = title;
  tc.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  tc.fill = TITLE_FILL;
  tc.alignment = { horizontal: 'left', vertical: 'middle' };
  // Company name on the right side of the same row
  // (ExcelJS single merge → put both in one string)
  tc.value = `${title}　　　　　　　　　${data.companyHeader}`;
  ws.getRow(r).height = 30;
  r++;

  // ── 2. Info grid (6 rows, left + right) — matches PDF drawInfoGrid exactly ──
  const leftRows: [string, string][] = [
    [partyLabel, data.partyName],
    ['聯絡人', data.partyContactName ?? ''],
    ['統一編號', data.partyTaxId ?? ''],
    ['電話', data.partyPhone ?? ''],
    ['地址', data.partyAddress ?? ''],
    ['送貨備註', data.deliveryNote ?? ''],
  ];
  const rightRows: [string, string][] = [
    [staffLabel, data.staffName],
    ['電話', data.staffPhone ?? ''],
    ['我方統編', data.companyTaxId ?? ''],
    ['地址', data.companyAddress ?? ''],
    [orderLabel, data.orderNo],
    ['開單日期', fmtDate(data.date)],
  ];

  for (let i = 0; i < 6; i++) {
    const row = ws.getRow(r);
    // Left label (A)
    row.getCell(1).value = leftRows[i][0];
    row.getCell(1).font = LABEL_FONT;
    row.getCell(1).border = THIN;
    // Left value (B+C merged)
    ws.mergeCells(r, 2, r, 3);
    row.getCell(2).value = leftRows[i][1];
    row.getCell(2).font = VALUE_FONT;
    row.getCell(2).border = THIN;
    row.getCell(3).border = THIN;
    // Right label (D)
    row.getCell(4).value = rightRows[i][0];
    row.getCell(4).font = LABEL_FONT;
    row.getCell(4).border = THIN;
    // Right value (E+F merged)
    ws.mergeCells(r, 5, r, 6);
    row.getCell(5).value = rightRows[i][1];
    row.getCell(5).font = VALUE_FONT;
    row.getCell(5).border = THIN;
    row.getCell(6).border = THIN;
    r++;
  }

  // blank separator
  ws.getRow(r).height = 6;
  r++;

  // ── 3. Item table header — matches PDF: 編號(6) 品項(38) 數量(8) 單價(14) 金額(14) 說明(22) ──
  const itemHeaders = ['編號', '品項', '數量', '單價', '金額', '說明'];
  const hRow = ws.getRow(r);
  hRow.height = 22;
  itemHeaders.forEach((h, idx) => {
    const cell = hRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
    cell.border = THIN;
    cell.alignment = { horizontal: idx >= 2 && idx <= 4 ? 'right' : (idx === 0 ? 'center' : 'left'), vertical: 'middle' };
  });
  r++;

  // ── 3a. Item rows (min 5 rows to match PDF itemMinRows) ──
  const minRows = 5;
  const totalItemRows = Math.max(data.items.length, minRows);
  for (let i = 0; i < totalItemRows; i++) {
    const it = data.items[i];
    const row = ws.getRow(r);
    if (it) {
      row.getCell(1).value = i + 1;
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).value = it.productName;
      row.getCell(3).value = it.quantity;
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).value = it.unitPrice;
      row.getCell(4).numFmt = '#,##0';
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).value = it.amount;
      row.getCell(5).numFmt = '#,##0';
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).value = it.note || '';
    }
    for (let c = 1; c <= 6; c++) {
      row.getCell(c).border = THIN;
      if (!it) row.getCell(c).value = '';
    }
    r++;
  }

  // ── 4. Totals — right-aligned matching PDF drawTotals ──
  // Totals positioned at columns D-E (label) and F (value), matching PDF layout
  const addTotalRow = (label: string, value: number, bold = false) => {
    const row = ws.getRow(r);
    ws.mergeCells(r, 4, r, 5);
    row.getCell(4).value = label;
    row.getCell(4).font = { bold: true, size: bold ? 11 : 10 };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).border = THIN;
    row.getCell(5).border = THIN;
    row.getCell(6).value = value;
    row.getCell(6).numFmt = '#,##0';
    row.getCell(6).font = { bold: true, size: bold ? 11 : 10 };
    row.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(6).border = THIN;
    r++;
  };
  addTotalRow('小計', data.subtotal);
  addTotalRow('營業稅 (5%)', data.taxAmount);
  addTotalRow('總計', data.totalAmount, true);

  // ── 5. Signature line — matches PDF ──
  r++;
  const sigRow = ws.getRow(r);
  if (isSales) {
    ws.mergeCells(r, 1, r, 3);
    sigRow.getCell(1).value = `出貨人：${data.deliveredBy ?? ''}`;
    sigRow.getCell(1).font = VALUE_FONT;
    ws.mergeCells(r, 4, r, 6);
    sigRow.getCell(4).value = `收貨人：${data.receivedBy ?? ''}`;
    sigRow.getCell(4).font = VALUE_FONT;
  } else {
    ws.mergeCells(r, 1, r, 3);
    sigRow.getCell(1).value = `進貨人：${data.staffName}`;
    sigRow.getCell(1).font = VALUE_FONT;
    ws.mergeCells(r, 4, r, 6);
    sigRow.getCell(4).value = '出貨人：';
    sigRow.getCell(4).font = VALUE_FONT;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
