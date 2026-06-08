/**
 * DEPRECATED (v2.16.0) -- Supabase Storage adapter.
 *
 * Files are now stored as `fileData` (Bytes) directly in the
 * ProductDocument / SupplierDocument rows in Neon PostgreSQL.
 * Downloads go through the /doc/:kind/:id?token=... endpoint.
 *
 * This file is kept only to avoid import errors from any transient
 * references. All functions throw with a clear deprecation message.
 *
 * LESSON LEARNED: When migrating a DB away from a platform that also
 * provides Storage/Auth/etc., audit ALL service dependencies first.
 * The Supabase project auto-deleted after DB inactivity, silently
 * destroying the Storage bucket and all uploaded files.
 */

const DEPRECATED = 'storage.ts is deprecated (v2.16.0). Files are stored in DB (fileData column).';

export async function uploadProductDoc(_storagePath: string, _bytes: Buffer, _mimeType: string): Promise<void> {
  throw new Error(DEPRECATED);
}

export async function deleteProductDoc(_storagePath: string): Promise<void> {
  throw new Error(DEPRECATED);
}

export async function createProductDocSignedUrl(_storagePath: string, _ttlSeconds: number): Promise<string> {
  throw new Error(DEPRECATED);
}

export async function uploadDoc(_storagePath: string, _bytes: Buffer, _mimeType: string): Promise<void> {
  throw new Error(DEPRECATED);
}

export async function deleteDoc(_storagePath: string): Promise<void> {
  throw new Error(DEPRECATED);
}

export async function createDocSignedUrl(_storagePath: string, _ttlSeconds: number): Promise<string> {
  throw new Error(DEPRECATED);
}
