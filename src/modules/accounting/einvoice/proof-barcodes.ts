import { createCipheriv, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';

/**
 * 電子發票證明聯一維/二維條碼產生器
 * 依「電子發票證明聯一維及二維條碼規格說明 v1.5」實作。
 *
 * - 一維 Code 39：發票期別(5) + 發票號碼(10) + 隨機碼(4) = 19 字
 * - 左 QR：InvoiceNo + Date(ROC) + Random + SalesHex + TotalHex +
 *           BuyerId + SellerId + Encrypt(24) + ":" + H品項數 +
 *           D品項數 + CharSet + Item1
 * - 右 QR："**" + 剩餘品項
 * - 加密：AES-128-CBC，IV 全 0，PKCS7，Base64 前 24 碼
 */

export interface ProofMeta {
  invoiceNo: string;           // "AB12345678"
  invoiceDate: Date;
  randomCode: string;          // 4 digits
  salesAmount: number;         // 未稅
  totalAmount: number;
  buyerTaxId: string | null;   // null → "00000000"
  sellerTaxId: string;
  aesKeyHex: string;           // 32-char hex (16 bytes); 空字串 → 以 sellerTaxId 衍生暫用金鑰
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
}

/** ROC (民國) date YYYMMDD — used in barcode + left QR. */
function rocDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${String(y).padStart(3, '0')}${m}${day}`;
}

/** 發票期別：民國年 + 月別（奇數月=次月為單期），格式 YYYMM，例 11304。 */
function invoicePeriod(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  let m = Number(parts.find((p) => p.type === 'month')!.value);
  if (m % 2 === 0) m -= 1; // 雙數月 → 前一期
  return `${String(y).padStart(3, '0')}${String(m).padStart(2, '0')}`;
}

/** 8-char upper-hex amount, 不足左補 0。負數以 00000000 輸出（證明聯不含退貨）。 */
function hexAmt(n: number): string {
  const v = Math.max(0, Math.round(n));
  return v.toString(16).toUpperCase().padStart(8, '0').slice(-8);
}

function deriveFallbackKey(sellerTaxId: string): Buffer {
  // 未設定正式 AES key 時用 sellerTaxId 的 SHA-256 前 16 bytes 做 stub 金鑰。
  // 正式上線必須改用整合服務平台下發的金鑰。issue() 在 production 已 fail-fast，
  // 這裡僅是雙保險（PDF 重產時仍會落到此路徑）。
  return createHash('sha256').update('stub:' + sellerTaxId).digest().subarray(0, 16);
}

let stubKeyWarned = false;
function aesKey(cfg: string, sellerTaxId: string): Buffer {
  if (cfg && /^[0-9a-fA-F]{32}$/.test(cfg)) return Buffer.from(cfg, 'hex');
  // 正式環境不該走到這裡（issue() 已擋）；若仍走到，console.warn 一次以利除錯。
  if (process.env.NODE_ENV === 'production' && !stubKeyWarned) {
    stubKeyWarned = true;
    console.warn('[einvoice] WARNING: falling back to stub AES key — PDF QR will fail platform verification');
  }
  return deriveFallbackKey(sellerTaxId);
}

export function encryptVerificationCode(meta: ProofMeta): string {
  const plaintext = meta.invoiceNo + meta.randomCode; // 14 chars
  const key = aesKey(meta.aesKeyHex, meta.sellerTaxId);
  const iv = Buffer.alloc(16, 0);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ct.toString('base64').slice(0, 24);
}

/** Code 39 content for 1D barcode. */
export function barcodeContent(meta: ProofMeta): string {
  return `${invoicePeriod(meta.invoiceDate)}${meta.invoiceNo}${meta.randomCode}`;
}

/** Left QR (含首品項)；右 QR 為剩餘品項。 */
export function buildQrPayloads(meta: ProofMeta): { left: string; right: string } {
  const buyer = meta.buyerTaxId && /^\d{8}$/.test(meta.buyerTaxId) ? meta.buyerTaxId : '00000000';
  const encrypt = encryptVerificationCode(meta);
  const itemCount = meta.items.length;
  const h = itemCount.toString().padStart(4, '0');
  const d = itemCount.toString().padStart(4, '0');

  // 首項塞入左 QR，其餘送右 QR。全部以 ":" 分隔。
  const first = meta.items[0];
  const firstStr = first ? `${first.description}:${first.quantity}:${first.unitPrice}` : '';
  const left = [
    meta.invoiceNo,
    rocDate(meta.invoiceDate),
    meta.randomCode,
    hexAmt(meta.salesAmount),
    hexAmt(meta.totalAmount),
    buyer,
    meta.sellerTaxId,
    encrypt,
    ':',
    h, d, '1',
    firstStr,
  ].join(':');

  const rest = meta.items.slice(1).map((it) => `${it.description}:${it.quantity}:${it.unitPrice}`).join(':');
  const right = rest ? `**:${rest}` : '**';
  return { left, right };
}

// ---------- rendering to PNG buffers for PDF embedding ----------

export async function renderQrPng(payload: string, size = 180): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'L',
    margin: 0,
    width: size,
    type: 'png',
  });
}

export async function renderBarcodePng(content: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code39',
    text: content,
    scale: 2,
    height: 10,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
}
