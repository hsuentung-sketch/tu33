/**
 * Product document service — upload / list / delete.
 *
 * v2.16.0+: Files stored as `fileData` (Bytes) in the ProductDocument row
 * inside Neon PostgreSQL. Replaces the old Supabase Storage approach.
 *
 * Downloads served via public /doc/product/:id?token=... endpoint (JWT-authed).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../../../shared/prisma.js';
import { signDocToken, buildDocUrl } from '../../../documents/doc-link.js';
import { createShortLink } from '../../core/shortlink/shortlink.service.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { config } from '../../../config/index.js';

export type DocumentType = 'PDS' | 'SDS' | 'DM' | 'OTHER';

const DOWNLOAD_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/'];

function sanitizeExt(fileName: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName);
  return m ? m[1].toLowerCase() : 'bin';
}

function buildStoragePath(tenantId: string, productId: string, type: DocumentType, ext: string) {
  const rnd = randomBytes(6).toString('hex');
  return `${tenantId}/${productId}/${type}/${rnd}.${ext}`;
}

export interface UploadInput {
  tenantId: string;
  productId: string;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  uploadedBy?: string;
}

export async function upload(input: UploadInput & { tenantId: string }) {
  if (input.bytes.length === 0) throw new ValidationError('檔案為空');
  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new ValidationError(`檔案太大（上限 ${MAX_FILE_BYTES / 1024 / 1024} MB）`);
  }
  if (!ALLOWED_MIME_PREFIXES.some((p) => input.mimeType.startsWith(p))) {
    throw new ValidationError(`不支援的檔案類型：${input.mimeType}`);
  }

  const product = await prisma.product.findFirst({
    where: { id: input.productId, tenantId: input.tenantId },
  });
  if (!product) throw new NotFoundError('Product', input.productId);

  const ext = sanitizeExt(input.fileName);
  const storagePath = buildStoragePath(input.tenantId, input.productId, input.type, ext);

  const row = await prisma.productDocument.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      type: input.type,
      fileName: input.fileName,
      storagePath, // legacy field, kept for backward compat
      fileSize: input.bytes.length,
      mimeType: input.mimeType,
      fileData: new Uint8Array(input.bytes),
      uploadedBy: input.uploadedBy ?? null,
    },
  });
  return row;
}

export async function list(tenantId: string, productId: string) {
  return prisma.productDocument.findMany({
    where: { tenantId, productId },
    // Exclude fileData from list queries (large blob)
    select: {
      id: true, tenantId: true, productId: true, type: true,
      fileName: true, storagePath: true, fileSize: true,
      mimeType: true, uploadedBy: true, createdAt: true,
    },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function remove(tenantId: string, docId: string) {
  const doc = await prisma.productDocument.findFirst({
    where: { id: docId, tenantId },
    select: { id: true },
  });
  if (!doc) throw new NotFoundError('ProductDocument', docId);
  await prisma.productDocument.delete({ where: { id: docId } });
  return { ok: true };
}

/**
 * Build a LINE-friendly download URL. Signs a JWT pointing to our
 * /doc/product/:id endpoint, wraps in a short link for clean URLs.
 */
export async function buildShortDownloadUrl(
  tenantId: string,
  docId: string,
  createdBy?: string,
): Promise<{ shortUrl: string; fileName: string; type: DocumentType }> {
  const doc = await prisma.productDocument.findFirst({
    where: { id: docId, tenantId },
    select: { id: true, fileName: true, type: true, tenantId: true },
  });
  if (!doc) throw new NotFoundError('ProductDocument', docId);

  const token = signDocToken(tenantId, 'product', docId, DOWNLOAD_TTL_SECONDS);
  const directUrl = buildDocUrl(config.publicBaseUrl, 'product', docId, token);

  const { code } = await createShortLink({
    target: directUrl,
    tenantId,
    label: doc.fileName,
    kind: 'doc',
    ttlSeconds: DOWNLOAD_TTL_SECONDS,
    createdBy,
  });
  const base = config.publicBaseUrl.replace(/\/$/, '');
  return {
    shortUrl: `${base}/s/${code}`,
    fileName: doc.fileName,
    type: doc.type as DocumentType,
  };
}
