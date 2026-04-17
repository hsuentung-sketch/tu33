/**
 * Short link service.
 *
 * Generates 7-char opaque codes that map to a target URL so we can
 * send human-readable download links in LINE ("https://host/s/AX7B2K")
 * instead of 150-char JWT-signed URLs. Security still sits on the
 * target URL — short links are just a display convenience.
 */
import { prisma } from '../../../shared/prisma.js';
import { logger } from '../../../shared/logger.js';

// Ambiguous glyphs (0/O, 1/I/L) removed so users can still type codes
// from a paper printout without mis-reading.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_LENGTH = 7;
const MAX_COLLISION_RETRIES = 5;

function generateCode(length = DEFAULT_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export interface CreateShortLinkInput {
  target: string;
  tenantId?: string;
  label?: string;
  kind?: string; // 'pdf' | 'doc' | ...
  ttlSeconds?: number;
  createdBy?: string;
}

export interface ShortLinkResolved {
  expired: boolean;
  target: string | null;
  label: string | null;
  kind: string | null;
}

/**
 * Insert a new short link row. Retries on unique-key collision (very
 * unlikely with 32^7 = 34B codes but cheap to guard against).
 */
export async function createShortLink(input: CreateShortLinkInput): Promise<{ code: string }> {
  const expiresAt =
    input.ttlSeconds && input.ttlSeconds > 0
      ? new Date(Date.now() + input.ttlSeconds * 1000)
      : null;

  for (let i = 0; i < MAX_COLLISION_RETRIES; i++) {
    const code = generateCode();
    try {
      await prisma.shortLink.create({
        data: {
          code,
          target: input.target,
          tenantId: input.tenantId ?? null,
          label: input.label ?? null,
          kind: input.kind ?? null,
          expiresAt,
          createdBy: input.createdBy ?? null,
        },
      });
      return { code };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002' && i < MAX_COLLISION_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new Error('Failed to generate unique short link code');
}

export async function resolveShortLink(code: string): Promise<ShortLinkResolved | null> {
  const row = await prisma.shortLink.findUnique({ where: { code } });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { expired: true, target: null, label: row.label, kind: row.kind };
  }
  // fire-and-forget hit counter; failures don't block redirect
  prisma.shortLink
    .update({ where: { code }, data: { hits: { increment: 1 } } })
    .catch((err: unknown) =>
      logger.warn('ShortLink hit counter failed', {
        code,
        error: (err as Error).message,
      }),
    );
  return { expired: false, target: row.target, label: row.label, kind: row.kind };
}
