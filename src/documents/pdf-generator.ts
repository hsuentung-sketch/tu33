import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type Decimal = Prisma.Decimal;

interface DocumentItem {
  productName: string;
  quantity: number;
  unitPrice: Decimal | number;
  amount: Decimal | number;
  note?: string | null;
}

interface QuotationPdfData {
  companyHeader: string;
  companyTaxId?: string | null;
  quotationNo: string;
  date: Date;
  customer: {
    name: string;
    contactName?: string | null;
    zipCode?: string | null;
    address?: string | null;
  };
  salesPerson: string;
  salesPhone?: string | null;
  items: DocumentItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  supplyTime?: string | null;
  paymentTerms?: string | null;
  validUntil?: string | null;
  note?: string | null;
  pdfFooter?: string;
  isDraft?: boolean;
}

interface SalesOrderPdfData {
  companyHeader: string;
  companyTaxId?: string | null;
  orderNo: string;
  date: Date;
  customer: {
    name: string;
    contactName?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  salesPerson: string;
  salesPhone?: string | null;
  companyAddress?: string;
  deliveryNote?: string | null;
  items: DocumentItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  deliveredBy?: string | null;
  receivedBy?: string | null;
  /** Linked e-invoice summary, rendered under the info grid. */
  einvoice?: {
    invoiceNo: string;
    invoiceDate: Date;
    voided: boolean;
  } | null;
  pdfFooter?: string;
}

interface PurchaseOrderPdfData {
  companyHeader: string;
  companyTaxId?: string | null;
  orderNo: string;
  date: Date;
  supplier: {
    name: string;
    contactName?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  internalStaff: string;
  staffPhone?: string | null;
  companyAddress?: string;
  deliveryNote?: string | null;
  items: (DocumentItem & { referenceCost?: number | null })[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  pdfFooter?: string;
}

/**
 * Locate a CJK-capable TTF/OTF. In order of preference:
 *   1. FONT_CJK_PATH env var (override)
 *   2. assets/fonts/NotoSansTC-Regular.ttf (downloaded at build time)
 *   3. Common Linux / macOS / Windows system font paths
 * If none are found we fall back to PDFKit's built-in Helvetica — which
 * cannot render Chinese. The caller will get tofu boxes but at least no
 * 500 error.
 */
const CJK_FONT: string = (() => {
  const candidates = [
    process.env.FONT_CJK_PATH,
    resolve(process.cwd(), 'assets/fonts/NotoSansTC-Regular.ttf'),
    resolve(process.cwd(), 'assets/fonts/NotoSansTC-Regular.otf'),
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    'C:/Windows/Fonts/msjh.ttc',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch { /* ignore */ }
  }
  return 'Helvetica';
})();

function formatDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function toNumber(val: Decimal | number): number {
  return typeof val === 'number' ? val : Number(val);
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('zh-TW');
}

// ---------- Layout helpers ----------
//
// The three PDF types share the same visual language (header band,
// two-column info grid, bordered item table, totals block). The
// helpers below exist so each generator only has to describe the data
// and the labels — not re-implement the drawing every time.

const PAGE = {
  margin: 40,
  contentWidth: 515, // A4 width (595) - 2 * margin
  left: 40,
  right: 555,
};

/** Title band at top: title text on left, company name on right. */
function drawTitleBand(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  company: string,
): number {
  const y = PAGE.margin;
  const h = 36;
  doc.save();
  doc.rect(PAGE.left, y, PAGE.contentWidth, h).fillAndStroke('#E8EEF7', '#2F5496');
  doc.restore();
  doc.fillColor('#000');
  doc.fontSize(18).text(title, PAGE.left + 10, y + 9, { width: 220 });
  doc.fontSize(16).text(company, PAGE.left + 240, y + 10, { width: 265, align: 'right' });
  return y + h;
}

type InfoRow = { label: string; value: string };

/**
 * Two-column information grid beneath the title band. Left and right
 * columns are padded to the same length with blank rows so the outer
 * border stays rectangular.
 */
function drawInfoGrid(
  doc: InstanceType<typeof PDFDocument>,
  startY: number,
  left: InfoRow[],
  right: InfoRow[],
): number {
  const rowH = 20;
  const rows = Math.max(left.length, right.length);
  const colW = PAGE.contentWidth / 2;
  const labelW = 58;

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(PAGE.left, startY, PAGE.contentWidth, rowH * rows).stroke();
  // vertical split between left/right columns
  doc.moveTo(PAGE.left + colW, startY).lineTo(PAGE.left + colW, startY + rowH * rows).stroke();

  doc.fontSize(9);
  for (let i = 0; i < rows; i++) {
    const y = startY + i * rowH;
    if (i > 0) {
      doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).stroke();
    }
    const l = left[i];
    const r = right[i];
    if (l) {
      doc.fillColor('#222').text(l.label, PAGE.left + 6, y + 6, { width: labelW });
      doc.fillColor('#000').text(l.value, PAGE.left + 6 + labelW, y + 6, { width: colW - labelW - 10 });
    }
    if (r) {
      doc.fillColor('#222').text(r.label, PAGE.left + colW + 6, y + 6, { width: labelW });
      doc.fillColor('#000').text(r.value, PAGE.left + colW + 6 + labelW, y + 6, { width: colW - labelW - 10 });
    }
  }
  doc.fillColor('#000');
  return startY + rowH * rows;
}

interface Column {
  header: string;
  width: number; // fraction of content width
  align?: 'left' | 'right' | 'center';
}

/** Bordered item table with header row + body rows. Returns y after table. */
function drawItemTable(
  doc: InstanceType<typeof PDFDocument>,
  startY: number,
  columns: Column[],
  rows: string[][],
  minRows: number = 5,
): number {
  // Pad to a minimum row count so quotation / sales / purchase PDFs share a
  // consistent visual footprint regardless of item count. Extra rows are empty
  // (blank cells) — caller always wins when rows.length > minRows.
  const padded = rows.length >= minRows
    ? rows
    : [...rows, ...Array.from({ length: minRows - rows.length }, () => columns.map(() => ''))];
  const headerH = 22;
  const rowH = 20;
  const totalFrac = columns.reduce((s, c) => s + c.width, 0);
  const xs: number[] = [PAGE.left];
  let accum = PAGE.left;
  for (const c of columns) {
    accum += (c.width / totalFrac) * PAGE.contentWidth;
    xs.push(accum);
  }

  // header row
  doc.save();
  doc.rect(PAGE.left, startY, PAGE.contentWidth, headerH).fillAndStroke('#DCE3EE', '#333');
  doc.restore();
  doc.fillColor('#000').fontSize(10);
  columns.forEach((c, i) => {
    doc.text(c.header, xs[i] + 4, startY + 6, {
      width: xs[i + 1] - xs[i] - 8,
      align: c.align ?? 'left',
    });
  });
  // header column dividers
  doc.lineWidth(0.9).strokeColor('#333');
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], startY).lineTo(xs[i], startY + headerH).stroke();
  }

  // body rows
  let y = startY + headerH;
  const bodyTop = y;
  doc.fontSize(9);
  padded.forEach((row) => {
    row.forEach((cell, i) => {
      doc.text(cell, xs[i] + 4, y + 6, {
        width: xs[i + 1] - xs[i] - 8,
        align: columns[i].align ?? 'left',
        height: rowH - 4,
        ellipsis: true,
      });
    });
    y += rowH;
  });
  // body outer + column dividers
  doc.rect(PAGE.left, bodyTop, PAGE.contentWidth, y - bodyTop).stroke();
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], bodyTop).lineTo(xs[i], y).stroke();
  }
  return y;
}

function drawTotals(
  doc: InstanceType<typeof PDFDocument>,
  startY: number,
  subtotal: number,
  tax: number,
  total: number,
): number {
  const rowH = 20;
  const blockW = 240;
  const x = PAGE.right - blockW;
  const labelW = 120;

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(x, startY, blockW, rowH * 3).stroke();
  doc.moveTo(x, startY + rowH).lineTo(x + blockW, startY + rowH).stroke();
  doc.moveTo(x, startY + rowH * 2).lineTo(x + blockW, startY + rowH * 2).stroke();
  doc.moveTo(x + labelW, startY).lineTo(x + labelW, startY + rowH * 3).stroke();

  doc.fillColor('#222').fontSize(10);
  doc.text('小計', x + 6, startY + 6, { width: labelW - 12 });
  doc.text('營業稅 (5%)', x + 6, startY + rowH + 6, { width: labelW - 12 });
  doc.fillColor('#000').fontSize(11);
  doc.text('總計', x + 6, startY + rowH * 2 + 6, { width: labelW - 12 });

  doc.fillColor('#000').fontSize(10);
  doc.text(formatCurrency(subtotal), x + labelW + 6, startY + 6, { width: blockW - labelW - 12, align: 'right' });
  doc.text(formatCurrency(tax), x + labelW + 6, startY + rowH + 6, { width: blockW - labelW - 12, align: 'right' });
  doc.fontSize(11);
  doc.text(formatCurrency(total), x + labelW + 6, startY + rowH * 2 + 6, { width: blockW - labelW - 12, align: 'right' });

  return startY + rowH * 3;
}

// ---------- Generators ----------

export function generateQuotationPdf(data: QuotationPdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
  doc.font(CJK_FONT);

  let y = drawTitleBand(doc, '報價單', data.companyHeader);

  if (data.isDraft) {
    doc.save();
    doc.fontSize(80).fillColor('#CCCCCC').opacity(0.25);
    doc.text('草稿', 160, 350);
    doc.restore();
    doc.fillColor('#000').opacity(1);
  }

  const addr = [data.customer.zipCode, data.customer.address].filter(Boolean).join(' ');
  y = drawInfoGrid(doc, y + 8, [
    { label: '公司', value: data.customer.name },
    { label: '聯絡人', value: data.customer.contactName ?? '' },
    { label: '地址', value: addr },
  ], [
    { label: '業務', value: data.salesPerson },
    { label: '電話', value: data.salesPhone ?? '' },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '報價單號', value: data.quotationNo },
    { label: '日期', value: formatDate(data.date) },
  ]);

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
    it.note ?? '',
  ]);
  y = drawItemTable(doc, y + 8, [
    { header: '編號', width: 6, align: 'center' },
    { header: '品項', width: 36 },
    { header: '數量', width: 8, align: 'right' },
    { header: '單價', width: 14, align: 'right' },
    { header: '金額', width: 14, align: 'right' },
    { header: '備註', width: 22 },
  ], rows);

  y = drawTotals(doc, y + 8, data.subtotal, data.taxAmount, data.totalAmount);

  // Terms block
  doc.fontSize(9).fillColor('#000');
  y += 16;
  const terms: string[] = [];
  if (data.supplyTime) terms.push(`可供貨時間：${data.supplyTime}`);
  if (data.paymentTerms) terms.push(`付款期限：${data.paymentTerms}`);
  if (data.validUntil) terms.push(`報價單有效日期：${data.validUntil}`);
  if (data.note) terms.push(`備註：${data.note}`);
  terms.forEach((t) => { doc.text(t, PAGE.left, y); y += 14; });

  if (data.pdfFooter) {
    doc.fontSize(8).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
  }
  return doc;
}

export function generateSalesOrderPdf(data: SalesOrderPdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
  doc.font(CJK_FONT);

  let y = drawTitleBand(doc, '銷貨單', data.companyHeader);

  const left: InfoRow[] = [
    { label: '公司', value: data.customer.name },
    { label: '聯絡人', value: data.customer.contactName ?? '' },
    { label: '統一編號', value: data.customer.taxId ?? '' },
    { label: '電話', value: data.customer.phone ?? '' },
    { label: '地址', value: data.customer.address ?? '' },
    { label: '送貨備註', value: data.deliveryNote ?? '' },
  ];
  const right: InfoRow[] = [
    { label: '業務', value: data.salesPerson },
    { label: '電話', value: data.salesPhone ?? '' },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '地址', value: data.companyAddress ?? '' },
    { label: '訂單編號', value: data.orderNo },
    { label: '開單日期', value: formatDate(data.date) },
  ];
  y = drawInfoGrid(doc, y + 8, left, right);

  // E-invoice badge (if linked). Kept as a single line so it doesn't
  // perturb the fixed 5-row item table rhythm.
  if (data.einvoice) {
    y += 6;
    const e = data.einvoice;
    if (e.voided) {
      doc.fontSize(10).fillColor('#C00');
      doc.text(`發票號碼：${e.invoiceNo}（已作廢）  發票日期：${formatDate(e.invoiceDate)}`, PAGE.left, y);
      doc.fillColor('#000');
    } else {
      doc.fontSize(10).fillColor('#000');
      doc.text(`發票號碼：${e.invoiceNo}　發票日期：${formatDate(e.invoiceDate)}`, PAGE.left, y);
    }
    y += 14;
  }

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
    it.note ?? '',
  ]);
  y = drawItemTable(doc, y + 8, [
    { header: '編號', width: 6, align: 'center' },
    { header: '品項', width: 36 },
    { header: '數量', width: 8, align: 'right' },
    { header: '單價', width: 14, align: 'right' },
    { header: '金額', width: 14, align: 'right' },
    { header: '說明', width: 22 },
  ], rows);

  y = drawTotals(doc, y + 8, data.subtotal, data.taxAmount, data.totalAmount);

  // Signatures
  y += 28;
  doc.fontSize(10).fillColor('#000');
  doc.text(`出貨人：${data.deliveredBy ?? ''}`, PAGE.left, y);
  doc.text(`收貨人：${data.receivedBy ?? ''}`, PAGE.left + PAGE.contentWidth / 2, y);

  if (data.pdfFooter) {
    doc.fontSize(8).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
  }
  return doc;
}

export function generatePurchaseOrderPdf(data: PurchaseOrderPdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
  doc.font(CJK_FONT);

  let y = drawTitleBand(doc, '進貨單', data.companyHeader);

  const left: InfoRow[] = [
    { label: '供應商', value: data.supplier.name },
    { label: '聯絡人', value: data.supplier.contactName ?? '' },
    { label: '統一編號', value: data.supplier.taxId ?? '' },
    { label: '電話', value: data.supplier.phone ?? '' },
    { label: '地址', value: data.supplier.address ?? '' },
    { label: '送貨備註', value: data.deliveryNote ?? '' },
  ];
  const right: InfoRow[] = [
    { label: '內勤', value: data.internalStaff },
    { label: '電話', value: data.staffPhone ?? '' },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '地址', value: data.companyAddress ?? '' },
    { label: '進貨單號', value: data.orderNo },
    { label: '開單日期', value: formatDate(data.date) },
  ];
  y = drawInfoGrid(doc, y + 8, left, right);

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
    it.note ?? '',
  ]);
  y = drawItemTable(doc, y + 8, [
    { header: '編號', width: 6, align: 'center' },
    { header: '品項', width: 36 },
    { header: '數量', width: 8, align: 'right' },
    { header: '單價', width: 14, align: 'right' },
    { header: '金額', width: 14, align: 'right' },
    { header: '說明', width: 22 },
  ], rows);

  y = drawTotals(doc, y + 8, data.subtotal, data.taxAmount, data.totalAmount);

  if (data.pdfFooter) {
    doc.fontSize(8).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
  }
  return doc;
}

// ============================================================
// 月結請款單 (Monthly Invoice / Statement)
// ============================================================

interface MonthlyInvoiceItem {
  orderNo: string;
  orderDate: Date;
  productName: string;
  quantity: number;
  unitPrice: Decimal | number;
  amount: Decimal | number;
  note?: string | null;
}

interface MonthlyInvoicePdfData {
  companyHeader: string;
  companyTaxId?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
  period: string;          // "2026/04"
  dueDate?: Date | null;
  customer: {
    name: string;
    contactName?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  rows: MonthlyInvoiceItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;       // 已收（本期）
  /**
   * 該客戶所有未付款的月份（含本期），最早→最晚排序。
   * 顯示在 totals 區塊下方，並計合計。
   */
  unpaidPeriods?: Array<{ period: string; amount: number }>;
  pdfFooter?: string;
}

export function generateMonthlyInvoicePdf(data: MonthlyInvoicePdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
  doc.font(CJK_FONT);

  let y = drawTitleBand(doc, '月結請款單', data.companyHeader);

  const left: InfoRow[] = [
    { label: '客戶', value: data.customer.name },
    { label: '聯絡人', value: data.customer.contactName ?? '' },
    { label: '統一編號', value: data.customer.taxId ?? '' },
    { label: '電話', value: data.customer.phone ?? '' },
    { label: '地址', value: data.customer.address ?? '' },
  ];
  const right: InfoRow[] = [
    { label: '請款期間', value: data.period },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '電話', value: data.companyPhone ?? '' },
    { label: '地址', value: data.companyAddress ?? '' },
    { label: '付款截止', value: data.dueDate ? formatDate(data.dueDate) : '' },
  ];
  y = drawInfoGrid(doc, y + 8, left, right);

  const rows = data.rows.map((it, i) => [
    String(i + 1),
    it.orderNo,
    formatDate(it.orderDate),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
  ]);
  y = drawItemTable(doc, y + 8, [
    { header: '編號', width: 6, align: 'center' },
    { header: '銷貨單號', width: 18 },
    { header: '日期', width: 16 },
    { header: '品項', width: 32 },
    { header: '數量', width: 7, align: 'right' },
    { header: '單價', width: 10, align: 'right' },
    { header: '金額', width: 11, align: 'right' },
  ], rows);

  // Custom totals block: subtotal / tax / total / paid / unpaid.
  const rowH = 20;
  const blockW = 240;
  const x = PAGE.right - blockW;
  const labelW = 120;
  const startY = y + 8;
  const unpaid = data.totalAmount - data.paidAmount;

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(x, startY, blockW, rowH * 5).stroke();
  for (let i = 1; i < 5; i++) {
    doc.moveTo(x, startY + rowH * i).lineTo(x + blockW, startY + rowH * i).stroke();
  }
  doc.moveTo(x + labelW, startY).lineTo(x + labelW, startY + rowH * 5).stroke();

  doc.fillColor('#222').fontSize(10);
  const labels = ['小計', '營業稅 (5%)', '總計', '已收', '本期應付'];
  const values = [data.subtotal, data.taxAmount, data.totalAmount, data.paidAmount, unpaid];
  labels.forEach((label, i) => {
    const big = i === 2 || i === 4;
    doc.fillColor('#222').fontSize(big ? 11 : 10);
    doc.text(label, x + 6, startY + rowH * i + 6, { width: labelW - 12 });
    doc.fillColor('#000').fontSize(big ? 11 : 10);
    doc.text(formatCurrency(values[i]), x + labelW + 6, startY + rowH * i + 6, {
      width: blockW - labelW - 12, align: 'right',
    });
  });

  // --- 未付款月份清單（該客戶全部未結案月份，含本期） ---
  const unpaidPeriods = data.unpaidPeriods ?? [];
  if (unpaidPeriods.length > 0) {
    const lineH = 16;
    const titleY = startY + rowH * 5 + 14;
    doc.fillColor('#000').fontSize(11).text('未付款月份', PAGE.left, titleY);
    let ry = titleY + lineH;
    const unpaidBoxW = 240;
    const ux = PAGE.right - unpaidBoxW;
    const ulabelW = 120;

    const rows = unpaidPeriods.length + 1; // +1 for 合計
    const topY = ry;
    doc.lineWidth(0.9).strokeColor('#333');
    doc.rect(ux, topY, unpaidBoxW, lineH * rows).stroke();
    doc.moveTo(ux + ulabelW, topY).lineTo(ux + ulabelW, topY + lineH * rows).stroke();

    let unpaidTotal = 0;
    unpaidPeriods.forEach((p, i) => {
      const lineY = topY + lineH * i;
      if (i > 0) doc.moveTo(ux, lineY).lineTo(ux + unpaidBoxW, lineY).stroke();
      doc.fillColor('#222').fontSize(9).text(p.period, ux + 6, lineY + 4, { width: ulabelW - 12 });
      doc.fillColor('#000').fontSize(9).text(formatCurrency(p.amount), ux + ulabelW + 6, lineY + 4, {
        width: unpaidBoxW - ulabelW - 12, align: 'right',
      });
      unpaidTotal += p.amount;
    });
    // 合計列
    const totalY = topY + lineH * unpaidPeriods.length;
    doc.moveTo(ux, totalY).lineTo(ux + unpaidBoxW, totalY).stroke();
    doc.fillColor('#222').fontSize(10).text('未付款合計', ux + 6, totalY + 3, { width: ulabelW - 12 });
    doc.fillColor('#000').fontSize(10).text(formatCurrency(unpaidTotal), ux + ulabelW + 6, totalY + 3, {
      width: unpaidBoxW - ulabelW - 12, align: 'right',
    });
  }

  if (data.pdfFooter) {
    doc.fontSize(8).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
  }
  return doc;
}

// ============================================================
// 月結應付對帳單 (Monthly Payable Statement)
// ============================================================

interface MonthlyPayableItem {
  orderNo: string;
  orderDate: Date;
  productName: string;
  quantity: number;
  unitPrice: Decimal | number;
  amount: Decimal | number;
  note?: string | null;
}

interface MonthlyPayablePdfData {
  companyHeader: string;
  companyTaxId?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
  period: string;
  dueDate?: Date | null;
  supplier: {
    name: string;
    contactName?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  rows: MonthlyPayableItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidPeriods?: Array<{ period: string; amount: number }>;
  pdfFooter?: string;
}

export function generateMonthlyPayablePdf(data: MonthlyPayablePdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
  doc.font(CJK_FONT);

  let y = drawTitleBand(doc, '月結應付對帳單', data.companyHeader);

  const left: InfoRow[] = [
    { label: '供應商', value: data.supplier.name },
    { label: '聯絡人', value: data.supplier.contactName ?? '' },
    { label: '統一編號', value: data.supplier.taxId ?? '' },
    { label: '電話', value: data.supplier.phone ?? '' },
    { label: '地址', value: data.supplier.address ?? '' },
  ];
  const right: InfoRow[] = [
    { label: '對帳期間', value: data.period },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '電話', value: data.companyPhone ?? '' },
    { label: '地址', value: data.companyAddress ?? '' },
    { label: '付款截止', value: data.dueDate ? formatDate(data.dueDate) : '' },
  ];
  y = drawInfoGrid(doc, y + 8, left, right);

  const itemRows = data.rows.map((it, i) => [
    String(i + 1),
    it.orderNo,
    formatDate(it.orderDate),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
  ]);
  y = drawItemTable(doc, y + 8, [
    { header: '編號', width: 6, align: 'center' },
    { header: '進貨單號', width: 18 },
    { header: '日期', width: 16 },
    { header: '品項', width: 32 },
    { header: '數量', width: 7, align: 'right' },
    { header: '單價', width: 10, align: 'right' },
    { header: '金額', width: 11, align: 'right' },
  ], itemRows);

  // Totals: 小計/稅/總計/已付/本期應付
  const rowH = 20;
  const blockW = 240;
  const x = PAGE.right - blockW;
  const labelW = 120;
  const startY = y + 8;
  const unpaid = data.totalAmount - data.paidAmount;

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(x, startY, blockW, rowH * 5).stroke();
  for (let i = 1; i < 5; i++) {
    doc.moveTo(x, startY + rowH * i).lineTo(x + blockW, startY + rowH * i).stroke();
  }
  doc.moveTo(x + labelW, startY).lineTo(x + labelW, startY + rowH * 5).stroke();

  const labels = ['小計', '營業稅 (5%)', '總計', '已付', '本期應付'];
  const values = [data.subtotal, data.taxAmount, data.totalAmount, data.paidAmount, unpaid];
  labels.forEach((label, i) => {
    const big = i === 2 || i === 4;
    doc.fillColor('#222').fontSize(big ? 11 : 10);
    doc.text(label, x + 6, startY + rowH * i + 6, { width: labelW - 12 });
    doc.fillColor('#000').fontSize(big ? 11 : 10);
    doc.text(formatCurrency(values[i]), x + labelW + 6, startY + rowH * i + 6, {
      width: blockW - labelW - 12, align: 'right',
    });
  });

  // Unpaid periods (all 未結案 months for this supplier)
  const unpaidPeriods = data.unpaidPeriods ?? [];
  if (unpaidPeriods.length > 0) {
    const lineH = 16;
    const titleY = startY + rowH * 5 + 14;
    doc.fillColor('#000').fontSize(11).text('未付款月份', PAGE.left, titleY);
    const unpaidBoxW = 240;
    const ux = PAGE.right - unpaidBoxW;
    const ulabelW = 120;
    const numRows = unpaidPeriods.length + 1;
    const topY = titleY + lineH;

    doc.lineWidth(0.9).strokeColor('#333');
    doc.rect(ux, topY, unpaidBoxW, lineH * numRows).stroke();
    doc.moveTo(ux + ulabelW, topY).lineTo(ux + ulabelW, topY + lineH * numRows).stroke();

    let unpaidTotal = 0;
    unpaidPeriods.forEach((p, i) => {
      const lineY = topY + lineH * i;
      if (i > 0) doc.moveTo(ux, lineY).lineTo(ux + unpaidBoxW, lineY).stroke();
      doc.fillColor('#222').fontSize(9).text(p.period, ux + 6, lineY + 4, { width: ulabelW - 12 });
      doc.fillColor('#000').fontSize(9).text(formatCurrency(p.amount), ux + ulabelW + 6, lineY + 4, {
        width: unpaidBoxW - ulabelW - 12, align: 'right',
      });
      unpaidTotal += p.amount;
    });
    const totalY = topY + lineH * unpaidPeriods.length;
    doc.moveTo(ux, totalY).lineTo(ux + unpaidBoxW, totalY).stroke();
    doc.fillColor('#222').fontSize(10).text('未付款合計', ux + 6, totalY + 3, { width: ulabelW - 12 });
    doc.fillColor('#000').fontSize(10).text(formatCurrency(unpaidTotal), ux + ulabelW + 6, totalY + 3, {
      width: unpaidBoxW - ulabelW - 12, align: 'right',
    });
  }

  if (data.pdfFooter) {
    doc.fontSize(8).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
  }
  return doc;
}
