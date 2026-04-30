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

const STAMP_DIR = process.env.STAMP_DIR
  || (existsSync('/data') ? '/data/stamps' : resolve(process.cwd(), 'data/stamps'));

function stampPathFor(tenantId: string): string {
  return resolve(STAMP_DIR, `${tenantId}.png`);
}

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
}

function rocDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

function periodStr(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  let m = Number(parts.find((p) => p.type === 'month')!.value);
  const period2 = m % 2 === 0 ? `${m - 1}-${m}` : `${m}-${m + 1}`;
  return `${y}年${period2}月`;
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
        if (zeroFlag) { str += '零'; zeroFlag = false; }
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
  // A5 直式 = 420 × 595pt
  const W = 420, H = 595;
  const M = 18;
  const doc = new PDFDocument({ size: [W, H], margin: M });
  doc.registerFont('cjk', CJK_FONT);
  doc.font('cjk');

  const left = M;
  const right = W - M;
  const contentW = right - left;

  // 標題列：公司名 / 「電子發票證明聯」 / 日期 / 格式 / 頁碼
  let y = M + 4;
  doc.fontSize(13).fillColor('#000').text(data.sellerName, left, y, { width: contentW, align: 'center' });
  y += 18;
  doc.fontSize(15).text('電子發票證明聯', left, y, { width: contentW, align: 'center' });
  y += 22;
  doc.fontSize(9).fillColor('#222');
  doc.text(rocDate(data.invoiceDate), left, y, { width: contentW, align: 'center' });
  y += 12;
  doc.text(`格式：${data.invoiceFormat ?? '25'}`, left, y, { width: contentW / 2, align: 'left' });
  doc.text('第1頁/共1頁', left + contentW / 2, y, { width: contentW / 2, align: 'right' });
  y += 14;

  // 發票號碼欄
  doc.fontSize(11).fillColor('#000');
  doc.text(`發票號碼：${data.invoiceNo}`, left, y, { width: contentW });
  y += 16;

  // 買方框
  const buyerBoxH = 56;
  doc.lineWidth(0.7).strokeColor('#333').rect(left, y, contentW, buyerBoxH).stroke();
  doc.fontSize(10);
  doc.text(`買方：${data.buyerName}`, left + 6, y + 6, { width: contentW - 12 });
  doc.text(`統一編號：${data.buyerTaxId ?? ''}`, left + 6, y + 22, { width: contentW - 12 });
  doc.text(`地址：${data.buyerAddress ?? ''}`, left + 6, y + 38, { width: contentW - 12 });
  y += buyerBoxH + 6;

  // 品項表
  const headerH = 20;
  const rowH = 18;
  const minRows = 4;
  const cols = [
    { header: '品名', width: 0.46 },
    { header: '數量', width: 0.10, align: 'right' as const },
    { header: '單價', width: 0.16, align: 'right' as const },
    { header: '金額', width: 0.16, align: 'right' as const },
    { header: '備註', width: 0.12 },
  ];
  const xs: number[] = [left];
  let acc = left;
  for (const c of cols) { acc += c.width * contentW; xs.push(acc); }

  // 表頭
  doc.save();
  doc.rect(left, y, contentW, headerH).fillAndStroke('#EEE', '#333');
  doc.restore();
  doc.fillColor('#000').fontSize(10);
  cols.forEach((c, i) => {
    doc.text(c.header, xs[i] + 4, y + 5, { width: xs[i + 1] - xs[i] - 8, align: c.align ?? 'left' });
  });
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], y).lineTo(xs[i], y + headerH).stroke();
  }
  let bodyTop = y + headerH;
  let by = bodyTop;
  doc.fontSize(10);
  const padded = data.items.length >= minRows
    ? data.items
    : [...data.items, ...Array.from({ length: minRows - data.items.length }, () => null as B2BEinvoicePdfData['items'][number] | null)];
  padded.forEach((it) => {
    if (it) {
      const amt = it.amount ?? Math.round(it.quantity * it.unitPrice);
      const cells = [
        it.description,
        String(it.quantity),
        Number(it.unitPrice).toLocaleString('zh-TW'),
        Number(amt).toLocaleString('zh-TW'),
        it.note ?? '',
      ];
      cells.forEach((cell, i) => {
        doc.text(cell, xs[i] + 4, by + 4, { width: xs[i + 1] - xs[i] - 8, align: cols[i].align ?? 'left', height: rowH - 4, ellipsis: true });
      });
    }
    by += rowH;
  });
  doc.rect(left, bodyTop, contentW, by - bodyTop).stroke();
  for (let i = 1; i < xs.length - 1; i++) {
    doc.moveTo(xs[i], bodyTop).lineTo(xs[i], by).stroke();
  }
  y = by + 6;

  // 銷售額 / 應稅勾選列 / 總計
  // 三列：銷售額合計 / 營業稅 應稅✓零稅率 免稅 / 總計
  const sumRowH = 20;
  const sumLabelW = 100;
  const sumValueW = contentW - sumLabelW;
  const sumStartY = y;
  // 銷售額
  doc.rect(left, sumStartY, sumLabelW, sumRowH).stroke();
  doc.rect(left + sumLabelW, sumStartY, sumValueW, sumRowH).stroke();
  doc.fontSize(10).fillColor('#222').text('銷售額合計', left + 6, sumStartY + 5);
  doc.fillColor('#000').text(Math.round(data.salesAmount).toLocaleString('zh-TW'), left + sumLabelW + 6, sumStartY + 5, { width: sumValueW - 12, align: 'right' });
  // 營業稅勾選列
  const taxY = sumStartY + sumRowH;
  doc.rect(left, taxY, sumLabelW, sumRowH).stroke();
  doc.rect(left + sumLabelW, taxY, sumValueW, sumRowH).stroke();
  doc.fillColor('#222').text('營業稅', left + 6, taxY + 5);
  // 三選一勾選 + 稅額
  const taxType = data.taxType ?? '1';
  const checkbox = (label: string, on: boolean) => `${on ? '☑' : '☐'} ${label}`;
  const choices = `${checkbox('應稅', taxType === '1')}   ${checkbox('零稅率', taxType === '2')}   ${checkbox('免稅', taxType === '3')}`;
  doc.fillColor('#000').fontSize(9).text(choices, left + sumLabelW + 6, taxY + 6, { width: sumValueW - 80, align: 'left' });
  doc.fontSize(10).text(Math.round(data.taxAmount).toLocaleString('zh-TW'), left + sumLabelW + sumValueW - 80, taxY + 5, { width: 74, align: 'right' });
  // 總計
  const totalY = taxY + sumRowH;
  doc.rect(left, totalY, sumLabelW, sumRowH).stroke();
  doc.rect(left + sumLabelW, totalY, sumValueW, sumRowH).stroke();
  doc.fillColor('#222').fontSize(11).text('總計', left + 6, totalY + 4);
  doc.fillColor('#000').fontSize(11).text(Math.round(data.totalAmount).toLocaleString('zh-TW'), left + sumLabelW + 6, totalY + 4, { width: sumValueW - 12, align: 'right' });
  y = totalY + sumRowH + 4;

  // 中文大寫
  const cnRowH = 22;
  doc.rect(left, y, contentW, cnRowH).stroke();
  doc.fontSize(10).fillColor('#222').text('總計新台幣（中文大寫）', left + 6, y + 6, { width: 130 });
  doc.fillColor('#000').fontSize(11).text(chineseUpperAmount(data.totalAmount), left + 140, y + 5, { width: contentW - 146 });
  y += cnRowH + 6;

  // 賣方框 + 蓋章區
  const sellerBoxH = 80;
  const stampW = 90;
  const sellerInfoW = contentW - stampW;
  doc.rect(left, y, sellerInfoW, sellerBoxH).stroke();
  doc.rect(left + sellerInfoW, y, stampW, sellerBoxH).stroke();
  doc.fontSize(10).fillColor('#222');
  doc.text(`出貨單號：${data.salesOrderNo ?? ''}${data.acCode ? `   AC：${data.acCode}` : ''}`, left + 6, y + 4, { width: sellerInfoW - 12 });
  doc.text(`賣方：${data.sellerName}`, left + 6, y + 22, { width: sellerInfoW - 12 });
  doc.text(`統一編號：${data.sellerTaxId}`, left + 6, y + 38, { width: sellerInfoW - 12 });
  doc.text(`地址：${data.sellerAddress ?? ''}`, left + 6, y + 54, { width: sellerInfoW - 12 });
  // 蓋章區標題
  doc.fillColor('#666').fontSize(8).text('營業人蓋統一發票專用章', left + sellerInfoW + 4, y + 4, { width: stampW - 8, align: 'center' });

  // 蓋章圖
  if (data.tenantId) {
    const path = stampPathFor(data.tenantId);
    if (existsSync(path)) {
      try {
        doc.save();
        doc.opacity(data.stampOpacity ?? 0.85);
        doc.image(path, left + sellerInfoW + 6, y + 14, { fit: [stampW - 12, sellerBoxH - 20], align: 'center', valign: 'center' });
        doc.restore();
        doc.opacity(1);
      } catch { /* ignore */ }
    }
  }
  y += sellerBoxH + 4;

  // 隨機碼 / 期別
  doc.fillColor('#444').fontSize(8);
  doc.text(`隨機碼：${data.randomCode ?? '0000'}    期別：${periodStr(data.invoiceDate)}`, left, y, { width: contentW, align: 'right' });

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
