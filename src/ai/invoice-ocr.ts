/**
 * 發票/收據 OCR：用 Google Vision text detection 抽出原文，再以 regex 抽欄位。
 *
 * 與 src/ai/ocr.ts (名片 OCR) 共用 Vision API key，但抽欄位邏輯不同。
 *
 * 抽取重點（依信心度由高至低）：
 *  - 金額（總計 / 合計 / 應付）— 取最後一個出現的（通常 footer 為總計）
 *  - 日期（西元 YYYY/MM/DD 或民國 YYY/MM/DD 或中華民國 XXX 年 X 月 X 日）
 *  - 商家名稱（首幾行中含「公司/超商/工坊/商行」或最大字體者；簡化版取第一行）
 *  - 統編（8 碼數字，可能標 "統編 / 統一編號"）
 *  - 發票號碼（XX-XXXXXXXX 兩碼英文+8 碼數字）
 *
 * 抽不到的欄位回 undefined；handler 再決定要 ask user 補或用預設。
 */
import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';

export interface InvoiceFields {
  merchantName?: string;
  amount?: number;          // integer 元
  invoiceDate?: Date;
  invoiceNo?: string;
  merchantTaxId?: string;
  rawText: string;
}

export async function recognizeInvoice(imageBuffer: Buffer): Promise<InvoiceFields> {
  if (!config.google.visionApiKey) {
    throw new Error('GOOGLE_VISION_API_KEY is not configured');
  }
  const base64Image = imageBuffer.toString('base64');
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${config.google.visionApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Image },
          features: [{ type: 'TEXT_DETECTION' }],
          imageContext: { languageHints: ['zh-Hant', 'en'] },
        }],
      }),
    },
  );
  if (!response.ok) {
    const errText = await response.text();
    logger.error('Vision API error (invoice)', { status: response.status, body: errText });
    throw new Error(`Vision API error ${response.status}: ${errText}`);
  }
  const data = (await response.json()) as {
    responses: Array<{ fullTextAnnotation?: { text: string } }>;
  };
  const rawText = data.responses[0]?.fullTextAnnotation?.text ?? '';
  return extractFields(rawText);
}

function extractFields(text: string): InvoiceFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return {
    merchantName: extractMerchant(lines),
    amount: extractAmount(text, lines),
    invoiceDate: extractDate(text),
    invoiceNo: extractInvoiceNo(text),
    merchantTaxId: extractTaxId(text),
    rawText: text,
  };
}

function extractMerchant(lines: string[]): string | undefined {
  // 優先順序：含「公司/超商/工坊/商行/股份/實業」的行 → 第一行非數字非英文 → undefined
  const COMPANY_RE = /(有限公司|股份有限公司|超商|工坊|商行|實業|企業|百貨|商號|餐廳|加油站)/;
  for (const line of lines.slice(0, 8)) {
    if (COMPANY_RE.test(line)) return line.slice(0, 40);
  }
  // fallback: 首行若含中文字且非純數字
  for (const line of lines.slice(0, 3)) {
    if (/[一-鿿]/.test(line) && !/^[\d\s.,/-]+$/.test(line)) {
      return line.slice(0, 40);
    }
  }
  return undefined;
}

function extractAmount(text: string, lines: string[]): number | undefined {
  // 先找「總計 / 合計 / 應付」附近的數字
  const KEYS = ['總計', '合計', '應付', '應收', 'Total', 'TOTAL'];
  let best: number | undefined;
  for (const line of lines) {
    for (const k of KEYS) {
      if (line.includes(k)) {
        const m = line.match(/[\d,]+/g);
        if (m) {
          // 取該行最後一個數字（通常是金額）
          const n = Number(m[m.length - 1].replace(/,/g, ''));
          if (Number.isFinite(n) && n > 0 && n < 100_000_000) best = n;
        }
      }
    }
  }
  if (best != null) return best;

  // fallback：取整段文字中所有「$ 數字」或「NT$ 數字」最大值
  const all = [...text.matchAll(/(?:NT\$|\$)\s?([\d,]+)/g)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (all.length) return Math.max(...all);

  return undefined;
}

function extractDate(text: string): Date | undefined {
  // 西元 YYYY/MM/DD 或 YYYY-MM-DD
  let m = text.match(/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return safeDate(Number(m[1]), Number(m[2]), Number(m[3]));
  // 民國 YYY/MM/DD 或 YYY-MM-DD（YYY = 100~999）
  m = text.match(/\b(1\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return safeDate(Number(m[1]) + 1911, Number(m[2]), Number(m[3]));
  // 中華民國 XXX 年 X 月 X 日
  m = text.match(/(?:中華民國\s*)?(1\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return safeDate(Number(m[1]) + 1911, Number(m[2]), Number(m[3]));
  return undefined;
}

function safeDate(y: number, mo: number, d: number): Date | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt;
}

function extractInvoiceNo(text: string): string | undefined {
  const m = text.match(/\b([A-Z]{2})[\s-]?(\d{8})\b/);
  if (m) return `${m[1]}${m[2]}`;
  return undefined;
}

function extractTaxId(text: string): string | undefined {
  // 「統一編號 12345678」或「統編 12345678」優先；fallback 任意 8 碼數字
  let m = text.match(/(?:統一編號|統編)[:\s]*(\d{8})/);
  if (m) return m[1];
  m = text.match(/\b\d{8}\b/);
  return m ? m[0] : undefined;
}
