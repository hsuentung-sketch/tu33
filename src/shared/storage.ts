/**
 * Supabase Storage adapter for server-side file operations.
 *
 * Uses the service-role key so uploads and signed-URL issuance work
 * without Row-Level Security headaches. NEVER expose this key to the
 * browser — the admin UI uploads via our Express endpoint, not directly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cached) return cached;
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error(
      'Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  cached = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cached;
}

export async function uploadProductDoc(
  storagePath: string,
  bytes: Buffer,
  mimeType: string,
): Promise<void> {
  const bucket = config.supabase.productDocsBucket;
  const { error } = await client()
    .storage.from(bucket)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) {
    // Include bucket + url host so misconfigured env vars surface clearly.
    const host = (() => { try { return new URL(config.supabase.url).host; } catch { return '?'; } })();
    throw new Error(`Storage upload failed (bucket=${bucket}, host=${host}): ${error.message}`);
  }
}

export async function deleteProductDoc(storagePath: string): Promise<void> {
  const { error } = await client()
    .storage.from(config.supabase.productDocsBucket)
    .remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

/**
 * Issue a time-limited signed URL that lets the holder download the
 * object without any further auth. We wrap this in a ShortLink so the
 * URL shown to LINE users stays short.
 */
export async function createProductDocSignedUrl(
  storagePath: string,
  ttlSeconds: number,
): Promise<string> {
  const { data, error } = await client()
    .storage.from(config.supabase.productDocsBucket)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Storage signed URL failed: ${error?.message ?? 'unknown error'}`);
  }
  return data.signedUrl;
}
