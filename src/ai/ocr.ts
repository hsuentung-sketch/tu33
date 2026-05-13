import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';

export interface BusinessCardFields {
  companyName?: string;
  contactName?: string;
  /** 職稱（v2.10.0+），例如「業務經理」「研發專員」 */
  title?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  rawText: string;
}

/**
 * Recognize text from business card image using Google Cloud Vision API.
 * Returns extracted structured fields.
 */
export async function recognizeBusinessCard(imageBuffer: Buffer): Promise<BusinessCardFields> {
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
        requests: [
          {
            image: { content: base64Image },
            features: [{ type: 'TEXT_DETECTION' }],
            imageContext: { languageHints: ['zh-Hant', 'en'] },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Vision API error', { status: response.status, body: errText });
    throw new Error(`Vision API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    responses: Array<{ fullTextAnnotation?: { text: string } }>;
  };
  const rawText = data.responses[0]?.fullTextAnnotation?.text ?? '';
  return extractFields(rawText);
}

function extractFields(text: string): BusinessCardFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const phoneRegex = /(\+?\d[\d\s\-()]{7,}\d)/;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  const taxIdRegex = /\b\d{8}\b/;
  const addressKeyword = /[市縣區鄉鎮街路段巷弄號樓]/;
  const companyKeyword = /(有限公司|股份有限公司|企業|工業|實業|商行)/;
  // 常見職稱 keyword（v2.10.0+）。中文 + 英文常見職稱。
  const titleKeyword = /(董事長|執行長|總經理|副總經理|副總|總監|協理|處長|廠長|主任|課長|股長|組長|經理|副理|專員|工程師|技師|助理|秘書|顧問|主管|業務|採購|研發|品保|品管|行政|財務|會計|CEO|CFO|CTO|COO|VP|President|Director|Manager|Engineer|Specialist|Sales|Marketing|Assistant)/i;

  let companyName: string | undefined;
  let contactName: string | undefined;
  let title: string | undefined;
  let phone: string | undefined;
  let email: string | undefined;
  let address: string | undefined;
  let taxId: string | undefined;

  for (const line of lines) {
    if (!email) {
      const m = line.match(emailRegex);
      if (m) email = m[0];
    }
    if (!phone) {
      const m = line.match(phoneRegex);
      if (m) phone = m[0].replace(/\s+/g, '');
    }
    if (!taxId) {
      const m = line.match(taxIdRegex);
      if (m) taxId = m[0];
    }
    if (!companyName && companyKeyword.test(line)) {
      companyName = line;
    }
    if (!address && addressKeyword.test(line) && line.length > 6) {
      address = line;
    }
  }

  // Title extraction\uff08v2.10.0+\uff09\uff1a\u627e\u542b title keyword \u7684\u77ed\u884c\uff1b\u540c\u884c\u53ef\u80fd\u662f\u300c\u696d\u52d9\u7d93\u7406 \u738b\u5c0f\u660e\u300d
  // \u62c6 token \u5f8c keyword \u70ba title\u3001\u7d14\u4e2d\u6587 2-6 \u5b57\u7576 contactName\u3002
  for (const line of lines) {
    if (line === companyName || line === address) continue;
    if (emailRegex.test(line) || phoneRegex.test(line) || taxIdRegex.test(line)) continue;
    if (line.length > 25) continue;
    if (!titleKeyword.test(line)) continue;
    if (title) break;
    const tokens = line.split(/[\s,\uff0c\u3001\/\uff0f]+/).filter(Boolean);
    const titleTokens: string[] = [];
    const nameTokens: string[] = [];
    for (const t of tokens) {
      if (titleKeyword.test(t)) titleTokens.push(t);
      else if (/^[\u4e00-\u9fff]+$/.test(t) && t.length >= 2 && t.length <= 6) nameTokens.push(t);
    }
    if (titleTokens.length > 0) {
      title = titleTokens.join(' ');
      if (!contactName && nameTokens.length > 0) contactName = nameTokens[0];
    } else {
      title = line;
    }
  }

  // Heuristic: contact name is a short line that isn't company/address/email/phone/title
  if (!contactName) {
    for (const line of lines) {
      if (line === companyName || line === address || line === title) continue;
      if (emailRegex.test(line) || phoneRegex.test(line)) continue;
      if (titleKeyword.test(line)) continue;
      if (line.length >= 2 && line.length <= 6 && /^[\u4e00-\u9fff]+$/.test(line)) {
        contactName = line;
        break;
      }
    }
  }

  return { companyName, contactName, title, phone, email, address, taxId, rawText: text };
}
