/**
 * Excel (xlsx) generator for sales orders and purchase orders.
 *
 * Uses ExcelJS to produce a workbook that mirrors the PDF layout:
 * header info + items table + totals. Returns a Buffer so the caller
 * can stream it to the HTTP response.
 */
import ExcelJS from 'exceljs';

interface ExcelItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string | null;
}

interface OrderExcelData {
  kind: 'sales' | 'purchase';
  companyHeader: string;
  companyTaxId?: string | null;
  orderNo: string;
  date: Date;
  /** 客戶 or 供應商 */
  partyLabel: string;
  partyName: string;
  partyPhone?: string | null;
  partyTaxId?: string | null;
  partyAddress?: string | null;
  staffLabel: string;
  staffName: string;
  staffPhone?: string | null;
  deliveryNote?: string | null;
  items: ExcelItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export async function generateOrderExcel(data: OrderExcelData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const title = data.kind === 'sales' ? '銷貨單' : '進貨單';
  const ws = wb.addWorksheet(title);

  // Column widths
  ws.columns = [
    { width: 6 },   // A: 編號
    { width: 30 },  // B: 品項
    { width: 10 },  // C: 數量
    { width: 14 },  // D: 單價
    { width: 14 },  // E: 金額
    { width: 20 },  // F: 備註
  ];

  const boldFont = { bold: true, size: 12 };
  const headerFont = { bold: true, size: 14 };
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };

  // Row 1: Title
  ws.mergeCells('A1:F1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${title}　　　　　　${data.companyHeader}`;
  titleCell.font = headerFont;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // Row 2-5: Header info
  const info: [string, string][] = [
    [data.partyLabel, data.partyName],
    [`${data.partyLabel}電話`, data.partyPhone || ''],
    [`${data.partyLabel}統編`, data.partyTaxId || ''],
    [`${data.partyLabel}地址`, data.partyAddress || ''],
  ];
  const infoRight: [string, string][] = [
    [data.staffLabel, data.staffName],
    ['電話', data.staffPhone || ''],
    ['我方統編', data.companyTaxId || ''],
    ['單號', data.orderNo],
  ];

  for (let i = 0; i < info.length; i++) {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = info[i][0];
    row.getCell(1).font = { bold: true, size: 10 };
    ws.mergeCells(i + 2, 2, i + 2, 3);
    row.getCell(2).value = info[i][1];
    row.getCell(4).value = infoRight[i][0];
    row.getCell(4).font = { bold: true, size: 10 };
    ws.mergeCells(i + 2, 5, i + 2, 6);
    row.getCell(5).value = infoRight[i][1];
  }
  // Row 6: date + delivery note
  const dateRow = ws.getRow(6);
  dateRow.getCell(1).value = '日期';
  dateRow.getCell(1).font = { bold: true, size: 10 };
  ws.mergeCells(6, 2, 6, 3);
  dateRow.getCell(2).value = fmtDate(data.date);
  dateRow.getCell(4).value = '備註';
  dateRow.getCell(4).font = { bold: true, size: 10 };
  ws.mergeCells(6, 5, 6, 6);
  dateRow.getCell(5).value = data.deliveryNote || '';

  // Row 7: blank
  ws.getRow(7).height = 6;

  // Row 8: Items header
  const headerRow = ws.getRow(8);
  const headers = ['編號', '品項', '數量', '單價', '金額', '備註'];
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.border = thinBorder;
    cell.alignment = { horizontal: idx >= 2 && idx <= 4 ? 'right' : 'left', vertical: 'middle' };
  });
  headerRow.height = 22;

  // Item rows
  let rowIdx = 9;
  for (let i = 0; i < data.items.length; i++) {
    const it = data.items[i];
    const row = ws.getRow(rowIdx);
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
    for (let c = 1; c <= 6; c++) {
      row.getCell(c).border = thinBorder;
    }
    rowIdx++;
  }

  // Totals
  rowIdx++;
  const addTotal = (label: string, value: number) => {
    const row = ws.getRow(rowIdx);
    ws.mergeCells(rowIdx, 4, rowIdx, 5);
    row.getCell(4).value = label;
    row.getCell(4).font = boldFont;
    row.getCell(4).alignment = { horizontal: 'right' };
    row.getCell(6).value = value;
    row.getCell(6).numFmt = '#,##0';
    row.getCell(6).font = boldFont;
    row.getCell(6).alignment = { horizontal: 'right' };
    rowIdx++;
  };
  addTotal('小計', data.subtotal);
  addTotal('營業稅 (5%)', data.taxAmount);
  addTotal('總計', data.totalAmount);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
