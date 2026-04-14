import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';

export type VoiceIntent =
  | 'create_sales_order'
  | 'create_quotation'
  | 'create_purchase_order'
  | 'query_customer'
  | 'query_product'
  | 'query_receivable'
  | 'unknown';

export interface ParsedVoiceCommand {
  intent: VoiceIntent;
  customerName?: string;
  supplierName?: string;
  items?: Array<{ productName: string; quantity: number; unitPrice?: number }>;
  query?: string;
  raw: string;
}

const SYSTEM_PROMPT = `你是 ERP 語音指令解析器。將使用者的中文語音轉文字輸入，解析為結構化 JSON。

輸出格式（僅輸出 JSON，不要其他文字）：
{
  "intent": "create_sales_order" | "create_quotation" | "create_purchase_order" | "query_customer" | "query_product" | "query_receivable" | "unknown",
  "customerName": "客戶名（若有）",
  "supplierName": "供應商名（若有）",
  "items": [{"productName": "品項", "quantity": 數量, "unitPrice": 單價}],
  "query": "搜尋關鍵字（查詢類指令）"
}

範例：
輸入：「幫我開一張銷貨單給毅金，EK-C-215 兩桶單價一萬七千二」
輸出：{"intent":"create_sales_order","customerName":"毅金","items":[{"productName":"EK-C-215","quantity":2,"unitPrice":17200}]}

輸入：「查詢客戶毅金」
輸出：{"intent":"query_customer","query":"毅金"}`;

/**
 * Parse Chinese voice transcript into structured ERP command using Claude Haiku.
 * Uses the smallest Claude model for minimal token cost.
 */
export async function parseVoiceCommand(transcript: string): Promise<ParsedVoiceCommand> {
  if (!config.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Anthropic API error', { status: response.status, body: errText });
    throw new Error(`Anthropic API error ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return { ...parsed, raw: transcript };
  } catch (err) {
    logger.warn('Failed to parse voice command JSON', { text, error: err });
    return { intent: 'unknown', raw: transcript };
  }
}
