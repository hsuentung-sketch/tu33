/**
 * B2B 電子發票證明聯（A5 直式）。對應使用者提供的範例 PDF：
 *   標題列（公司名 + 「電子發票證明聯」+ 期別 + 字軌格式 + 頁碼）
 *   買方框（公司 / 統編 / 地址）
 *   品項表
 *   小計 / 應稅或零稅率或免稅勾選列 / 營業稅 / 總計
 *   中文大寫金額
 *   賣方框（出貨單號 / AC / 公司 / 統編 / 地址） + 蓋章區
 *
 * B2C 仍走 einvoice-proof-pdf.ts（80mm 熱感紙 + barcode + dual QR）。
 */
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CJK_FONT: string = (() => {
  const candidates = [
    process.env.FONT_CJK_PATH,
    resolve(process.cwd(), 'assets/fonts/NotoSansTC-Regular.ttf'),
    resolve(process.cwd(), 'assets/fonts/NotoSansTC-Regular.otf'),
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    'C:/Windows/Fonts/msjh.ttc',
  ].filter(Boolean) as string[];
  for (const p of candidates) { try { if (existsSync(p)) return p; } catch { /* ignore */ } }
  return 'Helvetica';
})();

export interface B2BEinvoicePdfData {
  invoiceNo: string;          // 字軌號碼，如 YN75026143
  invoiceDate: Date;
  randomCode?: string;
  /** 字軌格式（25 = 三聯式） */
  invoiceFormat?: string;
  sellerName: string;
  sellerTaxId: string;
  sellerAddress?: string;
  buyerName: string;
  buyerTaxId?: string | null;
  buyerAddress?: string;
  /** 1=應稅 2=零稅率 3=免稅 */
  taxType?: string;
  salesAmount: number;
  taxAmount: number;
  totalAmount: number;
  items: Array<{ description: string; quantity: number; unitPrice: number; amount?: number; note?: string }>;
  /** 連動的銷貨單號，顯示在賣方框「出貨單號」欄 */
  salesOrderNo?: string;
  /** AC 字軌（與發票字軌不同），可選 */
  acCode?: string;
  voided?: boolean;
  /** 蓋章圖檔的 tenantId；無則不蓋章 */
  tenantId?: string;
  stampOpacity?: number;
  /** 證明聯 QR 加密金鑰（32 碼 hex / AES-128）。空字串會走 stub key（dev only）。 */
  aesKeyHex?: string;
}

function adDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

const CN_DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const CN_UNITS_SMALL = ['', '拾', '佰', '仟'];
const CN_UNITS_BIG = ['', '萬', '億', '兆'];

/** 將整數轉為中文大寫（會計用，如 7245 → 柒仟貳佰肆拾伍）。 */
function intToChineseUpper(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '零';
  n = Math.round(n);
  if (n === 0) return '零';
  // 4 位一節
  const sections: number[] = [];
  while (n > 0) { sections.push(n % 10000); n = Math.floor(n / 10000); }
  let result = '';
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];
    if (sec === 0) {
      // 跳過空節，但避免連續零；簡化處理：直接 join 後再壓縮多餘零
      result += '零';
      continue;
    }
    let str = '';
    let zeroFlag = false;
    for (let pos = 3; pos >= 0; pos--) {
      const d = Math.floor(sec / Math.pow(10, pos)) % 10;
      if (d === 0) {
        zeroFlag = true;
      } else {
        // 只有「節內已輸出過非零數字」時，夾在中間的 0 才補「零」。
        // 節開頭（str 仍為空）的高位 0 不補，否則會出現「零貳萬…」。
        if (zeroFlag) { if (str !== '') str += '零'; zeroFlag = false; }
        str += CN_DIGITS[d] + CN_UNITS_SMALL[pos];
      }
    }
    result += str + CN_UNITS_BIG[i];
  }
  // 壓多餘零
  result = result.replace(/零+/g, '零').replace(/零$/, '');
  return result;
}

export function chineseUpperAmount(n: number): string {
  return intToChineseUpper(n) + '元整';
}

export async function generateB2BEinvoicePdf(
  data: B2BEinvoicePdfData,
): Promise<InstanceType<typeof PDFDocument>> {
  // A4 直式 = 595.28 × 841.89pt（PDFKit 'A4' 標準）
  const doc = new PDFDocument({ size: 'A4', margin: 20 });
  const W = 595.28;
  const M = 20;
  doc.registerFont('cjk', CJK_FONT);
  doc.font('cjk');

  const left = M;
  const right = W - M;
  const contentW = right - left;

  // ============================================================
  // 頁首（比照財政部標準版）：
  //   置中三行：公司名 / 電子發票證明聯 / 日期
  //   左邊兩行：發票號碼 / 買方 / 統編 / 地址
  //   右邊兩行：格式:25 / 第 1 頁/共 1 頁
  // ============================================================
  let y = M + 4;
  doc.fontSize(15).fillColor('#000').text(data.sellerName, left, y, { width: contentW, align: 'center' });
  y += 20;
  doc.fontSize(11).text('電子發票證明聯', left, y, { width: contentW, align: 'center' });
  y += 16;
  doc.fontSize(10).fillColor('#222')
    .text(adDate(data.invoiceDate), left, y, { width: contentW, align: 'center' });
  y += 18;

  // 左：發票號碼；右：格式
  doc.fillColor('#000').fontSize(10);
  doc.text(`格式：${data.invoiceFormat ?? '25'}`, left, y, { width: contentW, align: 'right' });
  doc.text(`發票號碼：${data.invoiceNo}`, left, y, { width: contentW });
  y += 14;
  doc.text(`買方：${data.buyerName}`, left, y);
  doc.text('第1頁/共1頁', left, y, { width: contentW, align: 'right' });
  y += 14;
  doc.text(`統一編號：${data.buyerTaxId ?? ''}`, left, y);
  y += 14;
  doc.text(`地址：${data.buyerAddress ?? ''}`, left, y);
  y += 18;

  // ============================================================
  // 品項表：5 欄，備註欄塞出貨單號 / AC / 提示語（比照信鼎版）
  // ============================================================
  const headerH = 20;
  const rowH = 18;
  const minRows = 6;
  // 絕對寬度（pt）：前 4 欄總和 = leftBoxW（下方表尾左半寬），
  // 使備註欄的左邊界與下方「營業人蓋統一發票專用章」大方塊的左邊界對齊。
  const colName = 210;
  const colQty = 46;
  const colUnit = 74;
  const colAmt = 74;
  const leftBoxW = colName + colQty + colUnit + colAmt; // 404pt
  const rightBoxW = contentW - leftBoxW;
  const cols = [
    { header: '品名', width: colName },
    { header: '數量', width: colQty, align: 'right' as const },
    { header: '單價', width: colUnit, align: 'right' as const },
    { header: '金額', width: colAmt, align: 'right' as const },
    { header: '備註', width: rightBoxW },
  ];
  const xs: number[] = [left];
  let acc = left;
  for (const c of cols) { acc += c.width; xs.push(acc); }

  // 表頭
  doc.fillColor('#000').fontSize(10);
  doc.rect(left, y, contentW, headerH).stroke();
  cols.forEach((c, i) => {
    doc.text(c.header, xs[i] + 4, y + 5, { width: xs[i + 1] - xs[i] - 8, align: c.align ?? 'left' });
  });
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], y).lineTo(xs[i], y + headerH).stroke();
  }
  const bodyTop = y + headerH;
  let by = bodyTop;

  // 備註欄合併顯示（跨整個 body 高度）
  const remarkLines: string[] = [];
  if (data.salesOrderNo) remarkLines.push(`出貨單號：${data.salesOrderNo}`);
  if (data.acCode) remarkLines.push(`AC：${data.acCode}`);
  remarkLines.push('發票內容若有誤，請於當月更正，');
  remarkLines.push('隔月恕不受理。');

  const padded = data.items.length >= minRows
    ? data.items
    : [...data.items, ...Array.from({ length: minRows - data.items.length }, () => null as B2BEinvoicePdfData['items'][number] | null)];
  padded.forEach((it) => {
    if (it) {
      const amt = it.amount ?? Math.round(it.quantity * it.unitPrice);
      const cells = [
        it.description,
        String(it.quantity),
        Number(it.unitPrice).toLocaleString('zh-TW', { minimumFractionDigits: 2 }),
        Number(amt).toLocaleString('zh-TW'),
        '', // 備註欄由下方統一填入
      ];
      cells.forEach((cell, i) => {
        doc.text(cell, xs[i] + 4, by + 4, { width: xs[i + 1] - xs[i] - 8, align: cols[i].align ?? 'left', height: rowH - 4, ellipsis: true });
      });
    }
    by += rowH;
  });
  const bodyH = by - bodyTop;
  doc.rect(left, bodyTop, contentW, bodyH).stroke();
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], bodyTop).lineTo(xs[i], by).stroke();
  }
  // 填入合併的備註（跨整個 body 高度，起於第 1 列）
  doc.fontSize(9).fillColor('#000');
  doc.text(remarkLines.join('\n'), xs[4] + 4, bodyTop + 4, { width: xs[5] - xs[4] - 8, lineGap: 2 });
  y = by;

  // ============================================================
  // 表尾：左半是 4 個 row（銷售額 / 營業稅 / 總計 / 中文大寫），
  //       右半是一個大合併方塊（營業人蓋統一發票專用章 + 賣方 / 統編 / 地址）
  // ============================================================
  const footRowH = 20;
  const cnRowH = 22;
  const footH = footRowH * 3 + cnRowH;
  const footTop = y;

  // 營業稅 row 的 7 個獨立框格寬度（總和 = leftBoxW）
  // [營業稅 label] [應稅] [√] [零稅率] [√] [免稅] [√] → 稅額
  // 稅額顯示在最後一格右側；改用最後一小格塞金額（比照信鼎版把金額擠在右）
  // 為了與其他 rows 對齊 label(100pt) + value(leftBoxW-100)，這裡把
  // 前 6 小格塞在 100pt 的 label 空間內 + 第 7 格塞在 value 起點放稅額。
  const labelW = 100;
  const valueW = leftBoxW - labelW;

  // 左半 4 rows
  // Row 1: 銷售額合計
  let ry = footTop;
  doc.fontSize(10).fillColor('#000');
  doc.rect(left, ry, labelW, footRowH).stroke();
  doc.rect(left + labelW, ry, valueW, footRowH).stroke();
  doc.text('銷售額合計', left + 6, ry + 5);
  doc.text(Math.round(data.salesAmount).toLocaleString('zh-TW'), left + labelW + 6, ry + 5, { width: valueW - 12, align: 'right' });
  ry += footRowH;

  // Row 2: 營業稅（7 格：營業稅 | 應稅 | √ | 零稅率 | √ | 免稅 | √ | 稅額）
  const taxType = data.taxType ?? '1';
  // 前 6 個小格切在 leftBoxW 內（比 label+value 概念更細）：
  // 使用 leftBoxW 分成 7 欄，最後 1 欄為稅額
  const taxCells = [
    { w: 60, text: '營業稅', center: false },
    { w: 44, text: '應稅', center: true },
    { w: 34, text: taxType === '1' ? '√' : '', center: true },
    { w: 54, text: '零稅率', center: true },
    { w: 34, text: taxType === '2' ? '√' : '', center: true },
    { w: 44, text: '免稅', center: true },
    { w: 34, text: taxType === '3' ? '√' : '', center: true },
  ];
  const taxCellsTotal = taxCells.reduce((a, c) => a + c.w, 0);
  const taxAmountW = leftBoxW - taxCellsTotal;
  let cx = left;
  for (const c of taxCells) {
    doc.rect(cx, ry, c.w, footRowH).stroke();
    doc.fontSize(10).fillColor('#000').text(c.text, cx + 4, ry + 5, {
      width: c.w - 8, align: c.center ? 'center' : 'left',
    });
    cx += c.w;
  }
  doc.rect(cx, ry, taxAmountW, footRowH).stroke();
  doc.fontSize(10).text(Math.round(data.taxAmount).toLocaleString('zh-TW'), cx + 4, ry + 5, {
    width: taxAmountW - 8, align: 'right',
  });
  ry += footRowH;

  // Row 3: 總計
  doc.rect(left, ry, labelW, footRowH).stroke();
  doc.rect(left + labelW, ry, valueW, footRowH).stroke();
  doc.fontSize(11).text('總計', left + 6, ry + 4);
  doc.fontSize(11).text(Math.round(data.totalAmount).toLocaleString('zh-TW'), left + labelW + 6, ry + 4, { width: valueW - 12, align: 'right' });
  ry += footRowH;

  // Row 4: 總計新台幣（中文大寫）single-line label + single-line value
  doc.rect(left, ry, labelW, cnRowH).stroke();
  doc.rect(left + labelW, ry, valueW, cnRowH).stroke();
  doc.fontSize(10).text('總計新台幣（中文大寫）', left + 4, ry + 6, {
    width: labelW - 8, height: cnRowH - 8, lineBreak: false,
  });
  doc.fontSize(10).text(chineseUpperAmount(data.totalAmount), left + labelW + 6, ry + 6, {
    width: valueW - 12, align: 'right', height: cnRowH - 8, lineBreak: false,
  });

  // 右半合併大方塊
  const rBoxX = left + leftBoxW;
  doc.rect(rBoxX, footTop, rightBoxW, footH).stroke();
  // 上方標題 header 線
  const rHeaderH = footRowH;
  doc.moveTo(rBoxX, footTop + rHeaderH).lineTo(rBoxX + rightBoxW, footTop + rHeaderH).stroke();
  doc.fontSize(10).fillColor('#000').text('營業人蓋統一發票專用章', rBoxX + 4, footTop + 5, { width: rightBoxW - 8, align: 'center' });
  // 賣方三行資訊
  const sy = footTop + rHeaderH + 8;
  doc.fontSize(9).fillColor('#000');
  doc.text(`賣　方：${data.sellerName}`, rBoxX + 6, sy, { width: rightBoxW - 12 });
  doc.text(`統一編號：${data.sellerTaxId}`, rBoxX + 6, sy + 16, { width: rightBoxW - 12 });
  doc.text(`地　　址：${data.sellerAddress ?? ''}`, rBoxX + 6, sy + 32, { width: rightBoxW - 12 });

  y = footTop + footH + 6;

  // 已作廢浮水印
  if (data.voided) {
    doc.save();
    doc.opacity(0.4);
    doc.fillColor('#C00').fontSize(72).text('已作廢', 0, 240, { width: W, align: 'center' });
    doc.restore();
    doc.opacity(1);
    doc.fillColor('#000');
  }

  return doc;
}
