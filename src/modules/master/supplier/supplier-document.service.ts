/**
 * Supplier document service — upload / list / delete（v2.14.0+）。
 *
 * 仿 product-document.service.ts。檔案存 Supabase Storage（與產品文件
 * 共用 bucket），metadata 存 SupplierDocument 表。Path layout：
 *   supplier/{tenantId}/{supplierId}/{type}/{randomId}.{ext}
 *
 * 主要用途：存供應商的銀行存摺 PDF（匯款核對憑證），也可放合約等。
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../../../shared/prisma.js';
import { uploadDoc, deleteDoc, createDocSignedUrl } from '../../../shared/storage.js';
import { createShortLink } from '../../core/shortlink/shortlink.service.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { config } from '../../../config/index.js';

export type SupplierDocumentType = 'BANKBOOK' | 'CONTRACT' | 'OTHER';

const DOWNLOAD_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/'];

function sanitizeExt(fileName: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName);
  return m ? m[1].toLowerCase() : 'bin';
}

function buildStoragePath(tenantId: string, supplierId: string, type: SupplierDocumentType, ext: string) {
  const rnd = randomBytes(6).toString('hex');
  return `supplier/${tenantId}/${supplierId}/${type}/${rnd}.${ext}`;
}

export interface UploadInput {
  tenantId: string;
  supplierId: string;
  type: SupplierDocumentType;
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

  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, tenantId: input.tenantId },
  });
  if (!supplier) throw new NotFoundError('Supplier', input.supplierId);

  const ext = sanitizeExt(input.fileName);
  const storagePath = buildStoragePath(input.tenantId, input.supplierId, input.type, ext);

  await uploadDoc(storagePath, input.bytes, input.mimeType);

  try {
    return await prisma.supplierDocument.create({
      data: {
        tenantId: input.tenantId,
        supplierId: input.supplierId,
        type: input.type,
        fileName: input.fileName,
        storagePath,
        fileSize: input.bytes.length,
        mimeType: input.mimeType,
        uploadedBy: input.uploadedBy ?? null,
      },
    });
  } catch (err) {
    // Compensating delete so we don't leak an orphan object.
    await deleteDoc(storagePath).catch(() => {});
    throw err;
  }
}

export async function list(tenantId: string, supplierId: string) {
  return prisma.supplierDocument.findMany({
    where: { tenantId, supplierId },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function remove(tenantId: string, docId: string) {
  const doc = await prisma.supplierDocument.findFirst({
    where: { id: docId, tenantId },
  });
  if (!doc) throw new NotFoundError('SupplierDocument', docId);
  await deleteDoc(doc.storagePath).catch(() => {
    /* object may already be gone; ignore and delete DB row */
  });
  await prisma.supplierDocument.delete({ where: { id: docId } });
  return { ok: true };
}

/** Build a LINE-friendly download URL（short link 包 Supabase signed URL）。 */
export async function buildShortDownloadUrl(
  tenantId: string,
  docId: string,
  createdBy?: string,
): Promise<{ shortUrl: string; fileName: string; type: SupplierDocumentType }> {
  const doc = await prisma.supplierDocument.findFirst({
    where: { id: docId, tenantId },
  });
  if (!doc) throw new NotFoundError('SupplierDocument', docId);

  const signedUrl = await createDocSignedUrl(doc.storagePath, DOWNLOAD_TTL_SECONDS);
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
    type: doc.type as SupplierDocumentType,
  };
}
