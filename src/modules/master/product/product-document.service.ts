/**
 * Product document service — upload / list / delete.
 *
 * Stores files in Supabase Storage ("product-docs" bucket) and metadata
 * in the ProductDocument table. Path layout:
 *   {tenantId}/{productId}/{type}/{randomId}.{ext}
 *
 * Downloads are served through short links that wrap a Supabase signed URL.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../../../shared/prisma.js';
import {
  uploadProductDoc,
  deleteProductDoc,
  createProductDocSignedUrl,
} from '../../../shared/storage.js';
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

export async function upload(input: UploadInput) {
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

  await uploadProductDoc(storagePath, input.bytes, input.mimeType);

  try {
    const row = await prisma.productDocument.create({
      data: {
        tenantId: input.tenantId,
        productId: input.productId,
        type: input.type,
        fileName: input.fileName,
        storagePath,
        fileSize: input.bytes.length,
        mimeType: input.mimeType,
        uploadedBy: input.uploadedBy ?? null,
      },
    });
    return row;
  } catch (err) {
    // Compensating delete so we don't leak an orphan object.
    await deleteProductDoc(storagePath).catch(() => {});
    throw err;
  }
}

export async function list(tenantId: string, productId: string) {
  return prisma.productDocument.findMany({
    where: { tenantId, productId },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function remove(tenantId: string, docId: string) {
  const doc = await prisma.productDocument.findFirst({
    where: { id: docId, tenantId },
  });
  if (!doc) throw new NotFoundError('ProductDocument', docId);
  // Delete object first; if DB delete fails the orphan is worse than the reverse.
  await deleteProductDoc(doc.storagePath).catch(() => {
    /* object may already be gone; ignore and delete DB row */
  });
  await prisma.productDocument.delete({ where: { id: docId } });
  return { ok: true };
}

/**
 * Build a LINE-friendly download URL. Returns the short URL; the real
 * Supabase signed URL is stored as the short-link target.
 */
export async function buildShortDownloadUrl(
  tenantId: string,
  docId: string,
  createdBy?: string,
): Promise<{ shortUrl: string; fileName: string; type: DocumentType }> {
  const doc = await prisma.productDocument.findFirst({
    where: { id: docId, tenantId },
  });
  if (!doc) throw new NotFoundError('ProductDocument', docId);

  const signedUrl = await createProductDocSignedUrl(doc.storagePath, DOWNLOAD_TTL_SECONDS);
  const { code } = await createShortLink({
    target: signedUrl,
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
