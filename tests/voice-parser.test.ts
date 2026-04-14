import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Ensure the config loads without throwing — stub the API key.
process.env.ANTHROPIC_API_KEY = 'test-key';

describe('parseVoiceCommand', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a well-formed JSON response into intent + items', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '{"intent":"create_sales_order","customerName":"毅金","items":[{"productName":"EK-C-215","quantity":2,"unitPrice":17200}]}',
          },
        ],
      }),
    }) as any;

    const { parseVoiceCommand } = await import('../src/ai/voice-parser.js');
    const r = await parseVoiceCommand('幫我開一張銷貨單給毅金，EK-C-215 兩桶單價一萬七千二');
    expect(r.intent).toBe('create_sales_order');
    expect(r.customerName).toBe('毅金');
    expect(r.items).toEqual([{ productName: 'EK-C-215', quantity: 2, unitPrice: 17200 }]);
    expect(r.raw).toMatch(/毅金/);
  });

  it('extracts JSON from surrounding prose', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '以下是解析結果：\n{"intent":"query_customer","query":"毅金"}\n希望有幫助。',
          },
        ],
      }),
    }) as any;

    const { parseVoiceCommand } = await import('../src/ai/voice-parser.js');
    const r = await parseVoiceCommand('查詢客戶毅金');
    expect(r.intent).toBe('query_customer');
    expect(r.query).toBe('毅金');
  });

  it('returns unknown intent when JSON is malformed', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'not json at all' }] }),
    }) as any;

    const { parseVoiceCommand } = await import('../src/ai/voice-parser.js');
    const r = await parseVoiceCommand('random');
    expect(r.intent).toBe('unknown');
  });

  it('throws when Anthropic API returns non-OK', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    }) as any;

    const { parseVoiceCommand } = await import('../src/ai/voice-parser.js');
    await expect(parseVoiceCommand('x')).rejects.toThrow(/Anthropic API error 500/);
  });
});
