import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';

export interface BusinessCardFields {
  companyName?: string;
  contactName?: string;
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

  let companyName: string | undefined;
  let contactName: string | undefined;
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

  // Heuristic: contact name is a short line that isn't company/address/email/phone
  for (const line of lines) {
    if (line === companyName || line === address) continue;
    if (emailRegex.test(line) || phoneRegex.test(line)) continue;
    if (line.length >= 2 && line.length <= 6 && /^[\u4e00-\u9fff]+$/.test(line)) {
      contactName = line;
      break;
    }
  }

  return { companyName, contactName, phone, email, address, taxId, rawText: text };
}
