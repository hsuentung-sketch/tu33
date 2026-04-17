/**
 * PDF short-link helper.
 *
 * Wraps the existing JWT-signed PDF URL in a ShortLink row so we can
 * send "https://host/s/AX7B2K" to LINE users instead of a 150-char
 * token URL. Reuses signPdfToken/buildPdfUrl — the JWT still guards
 * the /pdf/:kind/:id endpoint; the short link is just a display wrapper.
 */
import { signPdfToken, buildPdfUrl, type PdfKind } from './pdf-link.js';
import { createShortLink } from '../modules/core/shortlink/shortlink.service.js';
import { config } from '../config/index.js';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface BuildPdfShortUrlInput {
  tenantId: string;
  kind: PdfKind;
  id: string;
  /** Filename-style label shown in the admin "short links" view — not part of the URL. */
  label?: string;
  ttlSeconds?: number;
  createdBy?: string;
}

/**
 * Build a short, LINE-friendly download URL for a PDF document.
 *
 * @returns a URL like "https://erp-line-bot.onrender.com/s/AX7B2K"
 */
export async function buildPdfShortUrl(input: BuildPdfShortUrlInput): Promise<string> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const token = signPdfToken(input.tenantId, input.kind, input.id, ttl);
  const target = buildPdfUrl(config.publicBaseUrl, input.kind, input.id, token);
  const { code } = await createShortLink({
    target,
    tenantId: input.tenantId,
    label: input.label,
    kind: 'pdf',
    ttlSeconds: ttl,
    createdBy: input.createdBy,
  });
  const base = config.publicBaseUrl.replace(/\/$/, '');
  return `${base}/s/${code}`;
}
