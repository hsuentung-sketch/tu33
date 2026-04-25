import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  barcodeContent, buildQrPayloads, renderQrPng, renderBarcodePng,
  type ProofMeta,
} from '../modules/accounting/einvoice/proof-barcodes.js';

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

export interface ProofPdfData extends ProofMeta {
  sellerName: string;
  sellerAddress?: string;
  buyerName?: string;
  taxAmount: number;
  voided?: boolean;
  items: Array<{ description: string; quantity: number; unitPrice: number; amount?: number }>;
  /** Y=列印證明聯樣張 N=載具/捐贈時僅顯示電子版 */
  printFlag?: string;
}

function rocDisplay(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}/${m}/${day}`;
}

function period(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  let m = Number(parts.find((p) => p.type === 'month')!.value);
  const period2 = m % 2 === 0 ? `${m - 1}-${m}` : `${m}-${m + 1}`;
  return `${y} 年 ${period2} 月`;
}

/** Render證明聯 PDF. Returns a PDFDocument that caller pipes to res. */
export async function generateProofPdf(data: ProofPdfData): Promise<InstanceType<typeof PDFDocument>> {
  const { left, right } = buildQrPayloads(data);
  const bc = barcodeContent(data);

  const [leftPng, rightPng, barcodePng] = await Promise.all([
    renderQrPng(left, 180),
    renderQrPng(right, 180),
    renderBarcodePng(bc),
  ]);

  // 80mm 熱感紙寬 = 226.77pt。留邊 8pt 兩側。
  const width = 227;
  const height = 520;
  const doc = new PDFDocument({ size: [width, height], margin: 10 });
  doc.registerFont('cjk', CJK_FONT);
  doc.font('cjk');

  const centerX = width / 2;
  let y = 14;

  // 期別
  doc.fontSize(10).text(`電子發票證明聯`, 0, y, { align: 'center', width });
  y += 14;
  doc.fontSize(9).text(period(data.invoiceDate), 0, y, { align: 'center', width });
  y += 12;
  doc.fontSize(14).text(data.invoiceNo, 0, y, { align: 'center', width });
  y += 18;

  doc.fontSize(8);
  doc.text(`${rocDisplay(data.invoiceDate)}   隨機碼：${data.randomCode}`, 0, y, { align: 'center', width });
  y += 10;
  doc.text(`總計：${Math.round(data.totalAmount)}   格式 25`, 0, y, { align: 'center', width });
  y += 10;

  const buyerLine = data.buyerTaxId && /^\d{8}$/.test(data.buyerTaxId)
    ? `買方：${data.buyerTaxId}`
    : '買方：--';
  doc.text(`賣方：${data.sellerTaxId}    ${buyerLine}`, 0, y, { align: 'center', width });
  y += 14;

  // 1D barcode
  doc.image(barcodePng, 10, y, { width: width - 20, height: 30 });
  y += 34;

  // 2D QR codes
  const qrSize = 95;
  const gap = (width - qrSize * 2) / 3;
  doc.image(leftPng, gap, y, { width: qrSize, height: qrSize });
  doc.image(rightPng, gap * 2 + qrSize, y, { width: qrSize, height: qrSize });
  y += qrSize + 10;

  // 公司資訊
  doc.fontSize(8);
  doc.text(data.sellerName, 10, y, { width: width - 20, align: 'center' });
  y += 10;
  if (data.sellerAddress) {
    doc.text(data.sellerAddress, 10, y, { width: width - 20, align: 'center' });
    y += 10;
  }
  y += 4;

  // 品項表
  doc.moveTo(10, y).lineTo(width - 10, y).lineWidth(0.3).stroke();
  y += 3;
  doc.fontSize(8).text('品名', 10, y, { width: 110 });
  doc.text('數量', 125, y, { width: 30, align: 'right' });
  doc.text('金額', 160, y, { width: 55, align: 'right' });
  y += 10;
  doc.moveTo(10, y).lineTo(width - 10, y).lineWidth(0.3).stroke();
  y += 2;

  for (const it of data.items) {
    const amt = it.amount ?? Math.round(it.quantity * it.unitPrice);
    doc.text(it.description, 10, y, { width: 110 });
    doc.text(String(it.quantity), 125, y, { width: 30, align: 'right' });
    doc.text(String(amt), 160, y, { width: 55, align: 'right' });
    y += 11;
  }
  doc.moveTo(10, y).lineTo(width - 10, y).lineWidth(0.3).stroke();
  y += 4;

  // 金額欄
  doc.fontSize(8);
  doc.text(`銷售額：${Math.round(data.salesAmount)}`, 10, y, { width: width - 20, align: 'right' });
  y += 10;
  doc.text(`營業稅：${Math.round(data.taxAmount)}`, 10, y, { width: width - 20, align: 'right' });
  y += 10;
  doc.fontSize(10).text(`總計：${Math.round(data.totalAmount)}`, 10, y, { width: width - 20, align: 'right' });
  y += 14;

  if (data.voided) {
    doc.fontSize(14).fillColor('red').text('已作廢', 0, y, { align: 'center', width });
    doc.fillColor('black');
    y += 20;
  }
  if (data.printFlag === 'N') {
    doc.fontSize(7).text('（買受人使用載具或捐贈，本聯僅供存查）', 10, y, { width: width - 20, align: 'center' });
  }

  return doc;
}
