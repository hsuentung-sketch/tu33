import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type Decimal = Prisma.Decimal;

/**
 * 蓋章圖檔目錄（與 tenant.router.ts stampPathFor 對齊）。
 * 不能 import 因為會循環依賴，所以複製常數。
 */
const STAMP_DIR = process.env.STAMP_DIR
  || (existsSync('/data') ? '/data/stamps' : resolve(process.cwd(), 'data/stamps'));

function stampPathFor(tenantId: string): string {
  return resolve(STAMP_DIR, `${tenantId}.png`);
}

// ---------- 字體尺寸 ----------
interface FontSizes {
  title: number;
  company: number;
  body: number;
  totalsBig: number;
  footer: number;
}
const FS_A4: FontSizes = { title: 20, company: 18, body: 12, totalsBig: 13, footer: 9 };
const FS_DOT: FontSizes = { title: 16, company: 14, body: 10, totalsBig: 11, footer: 8 };
/** @deprecated alias kept for unchanged generators */
const FS = FS_A4;

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
  /** 用來載入 /data/stamps/<tenantId>.png 在底部蓋發票章；無則略過。 */
  tenantId?: string;
  /** 0–1，預設 0.85 */
  stampOpacity?: number;
  quotationNo: string;
  date: Date;
  customer: {
    name: string;
    contactName?: string | null;
    phone?: string | null;
    taxId?: string | null;
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
// The PDF types share the same visual language (header band,
// two-column info grid, bordered item table, totals block). The
// helpers below accept a PageLayout so the same drawing logic can
// target different paper sizes (A4 for quotation / monthly; dot-matrix
// 中一刀 for sales order / purchase order).

interface PageLayout {
  margin: number;
  contentWidth: number;
  left: number;
  right: number;
  fs: FontSizes;
  /** Title band height */
  titleH: number;
  /** Info grid min row height */
  infoRowH: number;
  /** Info grid vertical padding */
  infoPad: number;
  /** Item table header height */
  itemHeaderH: number;
  /** Item table min row height */
  itemRowH: number;
  /** Item table vertical padding */
  itemPad: number;
  /** Minimum empty rows in item table */
  itemMinRows: number;
  /** Totals row height */
  totalsRowH: number;
  /** Gap between sections */
  gap: number;
}

/** A4 (595 × 842pt) — 報價單、月結請款單、月結應付 */
const LAYOUT_A4: PageLayout = {
  margin: 40, contentWidth: 515, left: 40, right: 555,
  fs: FS_A4,
  titleH: 40, infoRowH: 24, infoPad: 7,
  itemHeaderH: 26, itemRowH: 24, itemPad: 7, itemMinRows: 5,
  totalsRowH: 24, gap: 8,
};

/**
 * 點陣式印表機「中一刀」(241.3mm × 139.8mm = 684pt × 396pt)
 * — 銷貨單、進貨單
 */
const LAYOUT_DOT: PageLayout = {
  margin: 18, contentWidth: 648, left: 18, right: 666,
  fs: FS_DOT,
  titleH: 32, infoRowH: 16, infoPad: 3,
  itemHeaderH: 16, itemRowH: 16, itemPad: 3, itemMinRows: 5,
  totalsRowH: 16, gap: 4,
};

/** @deprecated back-compat alias for unchanged generators that still use PAGE */
const PAGE = LAYOUT_A4;

/** Title band at top: title text on left, company name on right. */
function drawTitleBand(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  company: string,
  L: PageLayout = LAYOUT_A4,
): number {
  const y = L.margin;
  const h = L.titleH;
  doc.save();
  doc.rect(L.left, y, L.contentWidth, h).fillAndStroke('#E8EEF7', '#2F5496');
  doc.restore();
  doc.fillColor('#000');
  // 兩段文字各自垂直置中
  const titleVOff = Math.round((h - L.fs.title) / 2);
  const compVOff = Math.round((h - L.fs.company) / 2);
  doc.fontSize(L.fs.title).text(title, L.left + 12, y + titleVOff, { width: L.contentWidth / 2 - 20 });
  doc.fontSize(L.fs.company).text(company, L.left + L.contentWidth / 2, y + compVOff, { width: L.contentWidth / 2 - 12, align: 'right' });
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
  L: PageLayout = LAYOUT_A4,
  /** 中間分隔線的 x 座標（預設 = 左右各半）。用於對齊品項表欄線。 */
  splitX?: number,
): number {
  const minRowH = L.infoRowH;
  const padTop = L.infoPad;
  const padBottom = L.infoPad;
  const rows = Math.max(left.length, right.length);
  const midX = splitX ?? (L.left + L.contentWidth / 2);
  const leftColW = midX - L.left;
  const rightColW = L.right - midX;
  const labelW = L === LAYOUT_DOT ? 48 : 54;
  const leftValueW = leftColW - labelW - 8;
  const rightValueW = rightColW - labelW - 8;

  doc.fontSize(L.fs.body);
  const rowHeights: number[] = [];
  for (let i = 0; i < rows; i++) {
    const l = left[i];
    const r = right[i];
    let lH = 0;
    let rH = 0;
    if (l && l.value) lH = doc.heightOfString(String(l.value), { width: leftValueW });
    if (r && r.value) rH = doc.heightOfString(String(r.value), { width: rightValueW });
    rowHeights.push(Math.max(minRowH, Math.max(lH, rH) + padTop + padBottom));
  }
  const totalH = rowHeights.reduce((s, h) => s + h, 0);

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(L.left, startY, L.contentWidth, totalH).stroke();
  doc.moveTo(midX, startY).lineTo(midX, startY + totalH).stroke();

  let y = startY;
  for (let i = 0; i < rows; i++) {
    if (i > 0) {
      doc.moveTo(L.left, y).lineTo(L.right, y).stroke();
    }
    const l = left[i];
    const r = right[i];
    if (l) {
      doc.fillColor('#222').text(l.label, L.left + 6, y + padTop, { width: labelW });
      doc.fillColor('#000').text(l.value, L.left + 4 + labelW, y + padTop, { width: leftValueW });
    }
    if (r) {
      doc.fillColor('#222').text(r.label, midX + 6, y + padTop, { width: labelW });
      doc.fillColor('#000').text(r.value, midX + 4 + labelW, y + padTop, { width: rightValueW });
    }
    y += rowHeights[i];
  }
  doc.fillColor('#000');
  return y;
}

interface Column {
  header: string;
  width: number; // fraction of content width
  align?: 'left' | 'right' | 'center';
}

/** Bordered item table with header row + body rows. Returns { y, xs } where xs = column x positions. */
function drawItemTable(
  doc: InstanceType<typeof PDFDocument>,
  startY: number,
  columns: Column[],
  rows: string[][],
  L: PageLayout = LAYOUT_A4,
): { y: number; xs: number[] } {
  const minRows = L.itemMinRows;
  const padded = rows.length >= minRows
    ? rows
    : [...rows, ...Array.from({ length: minRows - rows.length }, () => columns.map(() => ''))];
  const headerH = L.itemHeaderH;
  const minRowH = L.itemRowH;
  const padTop = L.itemPad;
  const padBottom = L.itemPad;
  const totalFrac = columns.reduce((s, c) => s + c.width, 0);
  const xs: number[] = [L.left];
  let accum = L.left;
  for (const c of columns) {
    accum += (c.width / totalFrac) * L.contentWidth;
    xs.push(accum);
  }

  // header row
  doc.save();
  doc.rect(L.left, startY, L.contentWidth, headerH).fillAndStroke('#DCE3EE', '#333');
  doc.restore();
  doc.fillColor('#000').fontSize(L.fs.body);
  columns.forEach((c, i) => {
    doc.text(c.header, xs[i] + 4, startY + L.itemPad, {
      width: xs[i + 1] - xs[i] - 8,
      align: 'center',
    });
  });
  doc.lineWidth(0.9).strokeColor('#333');
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], startY).lineTo(xs[i], startY + headerH).stroke();
  }

  // body rows
  doc.fontSize(L.fs.body);
  const rowHeights: number[] = padded.map((row) => {
    let maxCellH = 0;
    row.forEach((cell, i) => {
      if (!cell) return;
      const cellW = xs[i + 1] - xs[i] - 8;
      const h = doc.heightOfString(String(cell), { width: cellW });
      if (h > maxCellH) maxCellH = h;
    });
    return Math.max(minRowH, maxCellH + padTop + padBottom);
  });

  let y = startY + headerH;
  const bodyTop = y;
  padded.forEach((row, rIdx) => {
    const h = rowHeights[rIdx];
    if (rIdx > 0) {
      doc.moveTo(L.left, y).lineTo(L.right, y).stroke();
    }
    row.forEach((cell, i) => {
      doc.text(cell, xs[i] + 4, y + padTop, {
        width: xs[i + 1] - xs[i] - 8,
        align: columns[i].align ?? 'left',
      });
    });
    y += h;
  });
  doc.rect(L.left, bodyTop, L.contentWidth, y - bodyTop).stroke();
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], bodyTop).lineTo(xs[i], y).stroke();
  }
  return { y, xs };
}

/**
 * @param colXs 品項表欄位 x 座標陣列（來自 drawItemTable）。
 *   若提供，總計框左右邊對齊「單價」欄左緣 ~ 表右緣，
 *   中間分隔線對齊「金額」欄左緣。否則用固定 260pt 寬靠右。
 */
function drawTotals(
  doc: InstanceType<typeof PDFDocument>,
  startY: number,
  subtotal: number,
  tax: number,
  total: number,
  L: PageLayout = LAYOUT_A4,
  colXs?: number[],
): number {
  const rowH = L.totalsRowH;
  // colXs 有 7 個元素（6 欄 + 1），索引 3=單價左, 4=金額左, 6=表右
  const x = colXs ? colXs[3] : L.right - 260;
  const splitX = colXs ? colXs[4] : x + 130;
  const endX = colXs ? colXs[colXs.length - 1] : L.right;
  const blockW = endX - x;
  const labelW = splitX - x;
  const valW = endX - splitX;
  const vPad = Math.round((rowH - L.fs.body) / 2);

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(x, startY, blockW, rowH * 3).stroke();
  doc.moveTo(x, startY + rowH).lineTo(endX, startY + rowH).stroke();
  doc.moveTo(x, startY + rowH * 2).lineTo(endX, startY + rowH * 2).stroke();
  doc.moveTo(splitX, startY).lineTo(splitX, startY + rowH * 3).stroke();

  doc.fillColor('#222').fontSize(L.fs.body);
  doc.text('小計', x + 6, startY + vPad, { width: labelW - 12 });
  doc.text('營業稅 (5%)', x + 6, startY + rowH + vPad, { width: labelW - 12 });
  doc.fillColor('#000').fontSize(L.fs.totalsBig);
  doc.text('總計', x + 6, startY + rowH * 2 + vPad, { width: labelW - 12 });

  doc.fillColor('#000').fontSize(L.fs.body);
  doc.text(formatCurrency(subtotal), splitX + 6, startY + vPad, { width: valW - 12, align: 'right' });
  doc.text(formatCurrency(tax), splitX + 6, startY + rowH + vPad, { width: valW - 12, align: 'right' });
  doc.fontSize(L.fs.totalsBig);
  doc.text(formatCurrency(total), splitX + 6, startY + rowH * 2 + vPad, { width: valW - 12, align: 'right' });

  return startY + rowH * 3;
}

/**
 * 在指定位置蓋發票章。tenantId 為 null 或無圖檔時直接 return startY。
 * 圖檔讀 /data/stamps/<tenantId>.png（PNG，建議透明背景）。
 */
function drawSellerStamp(
  doc: InstanceType<typeof PDFDocument>,
  tenantId: string | undefined,
  x: number,
  y: number,
  size: number = 90,
  opacity: number = 0.85,
): void {
  if (!tenantId) return;
  const path = stampPathFor(tenantId);
  if (!existsSync(path)) return;
  try {
    doc.save();
    doc.opacity(opacity);
    doc.image(path, x, y, { fit: [size, size], align: 'center', valign: 'center' });
    doc.restore();
    doc.opacity(1);
  } catch { /* ignore */ }
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

  // 預先計算欄位 x，讓資訊格中線對齊品項表「數量｜單價」邊界
  const quoteCols: Column[] = [
    { header: '編號', width: 8, align: 'center' },
    { header: '品項', width: 36 },
    { header: '數量', width: 8, align: 'right' },
    { header: '單價', width: 14, align: 'right' },
    { header: '金額', width: 14, align: 'right' },
    { header: '備註', width: 22 },
  ];
  const quoteXs = computeColXs(quoteCols, LAYOUT_A4);
  const gridSplitX = quoteXs[3]; // 編號+品項+數量 後的邊界

  y = drawInfoGrid(doc, y + 8, [
    { label: '公司', value: data.customer.name },
    { label: '聯絡人', value: data.customer.contactName ?? '' },
    { label: '地址', value: addr },
    { label: '電話', value: data.customer.phone ?? '' },
    { label: '統編', value: data.customer.taxId ?? '' },
  ], [
    { label: '業務', value: data.salesPerson },
    { label: '電話', value: data.salesPhone ?? '' },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '報價單號', value: data.quotationNo },
    { label: '日期', value: formatDate(data.date) },
  ], LAYOUT_A4, gridSplitX);

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
    it.note ?? '',
  ]);
  y = drawItemTable(doc, y + 8, [
    { header: '編號', width: 8, align: 'center' },
    { header: '品項', width: 36 },
    { header: '數量', width: 8, align: 'right' },
    { header: '單價', width: 14, align: 'right' },
    { header: '金額', width: 14, align: 'right' },
    { header: '備註', width: 22 },
  ], rows).y;

  y = drawTotals(doc, y + 8, data.subtotal, data.taxAmount, data.totalAmount);

  // Terms block
  doc.fontSize(FS.body).fillColor('#000');
  y += 18;
  const terms: string[] = [];
  if (data.supplyTime) terms.push(`可供貨時間：${data.supplyTime}`);
  if (data.paymentTerms) terms.push(`付款期限：${data.paymentTerms}`);
  if (data.validUntil) terms.push(`報價單有效日期：${data.validUntil}`);
  if (data.note) terms.push(`備註：${data.note}`);
  terms.forEach((t) => { doc.text(t, PAGE.left, y); y += 18; });

  // pdfFooter（租戶備註條款）：緊接 terms 下方，靠左
  if (data.pdfFooter) {
    y += 6;
    doc.fontSize(FS.footer).fillColor('#555').text(data.pdfFooter, PAGE.left, y, { width: PAGE.contentWidth * 0.6, align: 'left' });
    y += doc.heightOfString(data.pdfFooter, { width: PAGE.contentWidth * 0.6 }) + 4;
  }

  // 發票章（蓋在右側，與 pdfFooter 同區段高度）
  const stampY = data.pdfFooter ? y - 90 : y + 6;
  drawSellerStamp(
    doc,
    data.tenantId,
    PAGE.right - 100,
    Math.max(stampY, y - 84),
    90,
    data.stampOpacity ?? 0.85,
  );
  return doc;
}

/** 中一刀品項欄位定義（銷貨/進貨共用） */
const DOT_ITEM_COLS: Column[] = [
  { header: '編號', width: 6, align: 'center' },
  { header: '品項', width: 38 },
  { header: '數量', width: 8, align: 'right' },
  { header: '單價', width: 14, align: 'right' },
  { header: '金額', width: 14, align: 'right' },
  { header: '說明', width: 22 },
];

/**
 * 計算品項表欄位 x 座標（不繪圖，純計算）。
 * 用於在 drawInfoGrid 前就知道「數量」欄右緣 x，讓資訊格中線對齊。
 */
function computeColXs(columns: Column[], L: PageLayout): number[] {
  const totalFrac = columns.reduce((s, c) => s + c.width, 0);
  const xs: number[] = [L.left];
  let accum = L.left;
  for (const c of columns) {
    accum += (c.width / totalFrac) * L.contentWidth;
    xs.push(accum);
  }
  return xs;
}

export function generateSalesOrderPdf(data: SalesOrderPdfData): InstanceType<typeof PDFDocument> {
  const L = LAYOUT_DOT;
  const doc = new PDFDocument({ size: [684, 396], margin: L.margin });
  doc.font(CJK_FONT);

  // 預先計算欄位 x，讓資訊格中線對齊「數量」欄右緣
  const colXs = computeColXs(DOT_ITEM_COLS, L);
  const gridSplitX = colXs[3]; // 編號+品項+數量 後的邊界

  let y = drawTitleBand(doc, '銷貨單', data.companyHeader, L);

  y = drawInfoGrid(doc, y + L.gap, [
    { label: '公司', value: data.customer.name },
    { label: '聯絡人', value: data.customer.contactName ?? '' },
    { label: '統一編號', value: data.customer.taxId ?? '' },
    { label: '電話', value: data.customer.phone ?? '' },
    { label: '地址', value: data.customer.address ?? '' },
    { label: '送貨備註', value: data.deliveryNote ?? '' },
  ], [
    { label: '業務', value: data.salesPerson },
    { label: '電話', value: data.salesPhone ?? '' },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '地址', value: data.companyAddress ?? '' },
    { label: '訂單編號', value: data.orderNo },
    { label: '開單日期', value: formatDate(data.date) },
  ], L, gridSplitX);

  // E-invoice badge
  if (data.einvoice) {
    y += 3;
    const e = data.einvoice;
    if (e.voided) {
      doc.fontSize(L.fs.body).fillColor('#C00');
      doc.text(`發票號碼：${e.invoiceNo}（已作廢）  發票日期：${formatDate(e.invoiceDate)}`, L.left, y);
      doc.fillColor('#000');
    } else {
      doc.fontSize(L.fs.body).fillColor('#000');
      doc.text(`發票號碼：${e.invoiceNo}　發票日期：${formatDate(e.invoiceDate)}`, L.left, y);
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
  const table = drawItemTable(doc, y + L.gap, DOT_ITEM_COLS, rows, L);
  y = table.y;

  // 總計框：左緣=「單價」欄左，分隔線=「金額」欄左，右緣=表右
  y = drawTotals(doc, y + L.gap, data.subtotal, data.taxAmount, data.totalAmount, L, table.xs);

  // 簽名欄
  y += 12;
  doc.fontSize(L.fs.body).fillColor('#000');
  doc.text(`出貨人：${data.deliveredBy ?? ''}`, L.left, y);
  doc.text(`收貨人：${data.receivedBy ?? ''}`, L.left + L.contentWidth / 2, y);

  if (data.pdfFooter) {
    doc.fontSize(L.fs.footer).fillColor('#555').text(data.pdfFooter, L.left, 380, { width: L.contentWidth, align: 'center' });
  }
  return doc;
}

export function generatePurchaseOrderPdf(data: PurchaseOrderPdfData): InstanceType<typeof PDFDocument> {
  const L = LAYOUT_DOT;
  const doc = new PDFDocument({ size: [684, 396], margin: L.margin });
  doc.font(CJK_FONT);

  const colXs = computeColXs(DOT_ITEM_COLS, L);
  const gridSplitX = colXs[3];

  let y = drawTitleBand(doc, '進貨單', data.companyHeader, L);

  y = drawInfoGrid(doc, y + L.gap, [
    { label: '供應商', value: data.supplier.name },
    { label: '聯絡人', value: data.supplier.contactName ?? '' },
    { label: '統一編號', value: data.supplier.taxId ?? '' },
    { label: '電話', value: data.supplier.phone ?? '' },
    { label: '地址', value: data.supplier.address ?? '' },
    { label: '送貨備註', value: data.deliveryNote ?? '' },
  ], [
    { label: '內勤', value: data.internalStaff },
    { label: '電話', value: data.staffPhone ?? '' },
    { label: '我方統編', value: data.companyTaxId ?? '' },
    { label: '地址', value: data.companyAddress ?? '' },
    { label: '進貨單號', value: data.orderNo },
    { label: '開單日期', value: formatDate(data.date) },
  ], L, gridSplitX);

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.productName,
    String(it.quantity),
    formatCurrency(toNumber(it.unitPrice)),
    formatCurrency(toNumber(it.amount)),
    it.note ?? '',
  ]);
  const table = drawItemTable(doc, y + L.gap, DOT_ITEM_COLS, rows, L);
  y = table.y;

  y = drawTotals(doc, y + L.gap, data.subtotal, data.taxAmount, data.totalAmount, L, table.xs);

  // 簽名欄
  y += 12;
  doc.fontSize(L.fs.body).fillColor('#000');
  doc.text(`進貨人：${data.internalStaff}`, L.left, y);
  doc.text(`出貨人：`, L.left + L.contentWidth / 2, y);

  if (data.pdfFooter) {
    doc.fontSize(L.fs.footer).fillColor('#555').text(data.pdfFooter, L.left, 380, { width: L.contentWidth, align: 'center' });
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
    { header: '編號', width: 8, align: 'center' },
    { header: '銷貨單號', width: 18 },
    { header: '日期', width: 16 },
    { header: '品項', width: 32 },
    { header: '數量', width: 7, align: 'right' },
    { header: '單價', width: 10, align: 'right' },
    { header: '金額', width: 11, align: 'right' },
  ], rows).y;

  // Custom totals block: subtotal / tax / total / paid / unpaid.
  const rowH = 24;
  const blockW = 260;
  const x = PAGE.right - blockW;
  const labelW = 130;
  const startY = y + 8;
  const unpaid = data.totalAmount - data.paidAmount;

  doc.lineWidth(0.9).strokeColor('#333');
  doc.rect(x, startY, blockW, rowH * 5).stroke();
  for (let i = 1; i < 5; i++) {
    doc.moveTo(x, startY + rowH * i).lineTo(x + blockW, startY + rowH * i).stroke();
  }
  doc.moveTo(x + labelW, startY).lineTo(x + labelW, startY + rowH * 5).stroke();

  const labels = ['小計', '營業稅 (5%)', '總計', '已收', '本期應付'];
  const values = [data.subtotal, data.taxAmount, data.totalAmount, data.paidAmount, unpaid];
  labels.forEach((label, i) => {
    const big = i === 2 || i === 4;
    doc.fillColor('#222').fontSize(big ? FS.totalsBig : FS.body);
    doc.text(label, x + 6, startY + rowH * i + 7, { width: labelW - 12 });
    doc.fillColor('#000').fontSize(big ? FS.totalsBig : FS.body);
    doc.text(formatCurrency(values[i]), x + labelW + 6, startY + rowH * i + 7, {
      width: blockW - labelW - 12, align: 'right',
    });
  });

  // --- 未付款月份清單（該客戶全部未結案月份，含本期） ---
  const unpaidPeriods = data.unpaidPeriods ?? [];
  if (unpaidPeriods.length > 0) {
    const lineH = 20;
    const titleY = startY + rowH * 5 + 16;
    doc.fillColor('#000').fontSize(FS.totalsBig).text('未付款月份', PAGE.left, titleY);
    const ry = titleY + lineH;
    const unpaidBoxW = 260;
    const ux = PAGE.right - unpaidBoxW;
    const ulabelW = 130;

    const rows = unpaidPeriods.length + 1; // +1 for 合計
    const topY = ry;
    doc.lineWidth(0.9).strokeColor('#333');
    doc.rect(ux, topY, unpaidBoxW, lineH * rows).stroke();
    doc.moveTo(ux + ulabelW, topY).lineTo(ux + ulabelW, topY + lineH * rows).stroke();

    let unpaidTotal = 0;
    unpaidPeriods.forEach((p, i) => {
      const lineY = topY + lineH * i;
      if (i > 0) doc.moveTo(ux, lineY).lineTo(ux + unpaidBoxW, lineY).stroke();
      doc.fillColor('#222').fontSize(FS.body).text(p.period, ux + 6, lineY + 5, { width: ulabelW - 12 });
      doc.fillColor('#000').fontSize(FS.body).text(formatCurrency(p.amount), ux + ulabelW + 6, lineY + 5, {
        width: unpaidBoxW - ulabelW - 12, align: 'right',
      });
      unpaidTotal += p.amount;
    });
    // 合計列
    const totalY = topY + lineH * unpaidPeriods.length;
    doc.moveTo(ux, totalY).lineTo(ux + unpaidBoxW, totalY).stroke();
    doc.fillColor('#222').fontSize(FS.body).text('未付款合計', ux + 6, totalY + 5, { width: ulabelW - 12 });
    doc.fillColor('#000').fontSize(FS.body).text(formatCurrency(unpaidTotal), ux + ulabelW + 6, totalY + 5, {
      width: unpaidBoxW - ulabelW - 12, align: 'right',
    });
  }

  if (data.pdfFooter) {
    doc.fontSize(FS.footer).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
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
    { header: '編號', width: 8, align: 'center' },
    { header: '進貨單號', width: 18 },
    { header: '日期', width: 16 },
    { header: '品項', width: 32 },
    { header: '數量', width: 7, align: 'right' },
    { header: '單價', width: 10, align: 'right' },
    { header: '金額', width: 11, align: 'right' },
  ], itemRows).y;

  // Totals: 小計/稅/總計/已付/本期應付
  const rowH = 24;
  const blockW = 260;
  const x = PAGE.right - blockW;
  const labelW = 130;
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
    doc.fillColor('#222').fontSize(big ? FS.totalsBig : FS.body);
    doc.text(label, x + 6, startY + rowH * i + 7, { width: labelW - 12 });
    doc.fillColor('#000').fontSize(big ? FS.totalsBig : FS.body);
    doc.text(formatCurrency(values[i]), x + labelW + 6, startY + rowH * i + 7, {
      width: blockW - labelW - 12, align: 'right',
    });
  });

  // Unpaid periods (all 未結案 months for this supplier)
  const unpaidPeriods = data.unpaidPeriods ?? [];
  if (unpaidPeriods.length > 0) {
    const lineH = 20;
    const titleY = startY + rowH * 5 + 16;
    doc.fillColor('#000').fontSize(FS.totalsBig).text('未付款月份', PAGE.left, titleY);
    const unpaidBoxW = 260;
    const ux = PAGE.right - unpaidBoxW;
    const ulabelW = 130;
    const numRows = unpaidPeriods.length + 1;
    const topY = titleY + lineH;

    doc.lineWidth(0.9).strokeColor('#333');
    doc.rect(ux, topY, unpaidBoxW, lineH * numRows).stroke();
    doc.moveTo(ux + ulabelW, topY).lineTo(ux + ulabelW, topY + lineH * numRows).stroke();

    let unpaidTotal = 0;
    unpaidPeriods.forEach((p, i) => {
      const lineY = topY + lineH * i;
      if (i > 0) doc.moveTo(ux, lineY).lineTo(ux + unpaidBoxW, lineY).stroke();
      doc.fillColor('#222').fontSize(FS.body).text(p.period, ux + 6, lineY + 5, { width: ulabelW - 12 });
      doc.fillColor('#000').fontSize(FS.body).text(formatCurrency(p.amount), ux + ulabelW + 6, lineY + 5, {
        width: unpaidBoxW - ulabelW - 12, align: 'right',
      });
      unpaidTotal += p.amount;
    });
    const totalY = topY + lineH * unpaidPeriods.length;
    doc.moveTo(ux, totalY).lineTo(ux + unpaidBoxW, totalY).stroke();
    doc.fillColor('#222').fontSize(FS.body).text('未付款合計', ux + 6, totalY + 5, { width: ulabelW - 12 });
    doc.fillColor('#000').fontSize(FS.body).text(formatCurrency(unpaidTotal), ux + ulabelW + 6, totalY + 5, {
      width: unpaidBoxW - ulabelW - 12, align: 'right',
    });
  }

  if (data.pdfFooter) {
    doc.fontSize(FS.footer).fillColor('#555').text(data.pdfFooter, PAGE.left, 800, { width: PAGE.contentWidth, align: 'center' });
  }
  return doc;
}
