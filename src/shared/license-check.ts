/**
 * License check client (V0.12.0 F.3)
 *
 * Polls CP license verify endpoint and caches the result in memory.
 * Offline-tolerant: if CP is unreachable AND the last valid check
 * was < 24 h ago, the license is still considered valid.
 */
import { config } from '../config/index.js';
import { logger } from './logger.js';

export interface LicenseResult {
  valid: boolean;
  inGracePeriod: boolean;
  features: string[];
  expiresAt: string | null;
  companyName: string | null;
}

interface CacheEntry {
  result: LicenseResult;
  checkedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;          // 1 hour
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;  // 24 hours
const FETCH_TIMEOUT_MS = 5_000;

let cache: CacheEntry | null = null;

/** Return the last known-good timestamp, or 0 if never valid. */
let lastValidAt = 0;

function defaultResult(): LicenseResult {
  return { valid: true, inGracePeriod: false, features: ['core'], expiresAt: null, companyName: null };
}

/**
 * Check license validity. Returns cached result if fresh enough.
 * - No CP_BASE_URL or LICENSE_KEY  -> always valid (dev mode)
 * - CP unreachable within 24 h of last valid check -> still valid
 * - CP unreachable beyond 24 h -> invalid
 */
export async function checkLicense(): Promise<LicenseResult> {
  const { baseUrl, licenseKey } = config.controlPlane;
  if (!baseUrl || !licenseKey) return defaultResult();

  const now = Date.now();

  // Return cached result if still fresh
  if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/platform/license/verify?licenseKey=${encodeURIComponent(licenseKey)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`CP responded ${res.status}`);
    }
    const body = await res.json() as {
      valid: boolean;
      inGracePeriod?: boolean;
      features?: string[];
      expiresAt?: string;
      companyName?: string;
    };

    const result: LicenseResult = {
      valid: body.valid,
      inGracePeriod: body.inGracePeriod ?? false,
      features: body.features ?? ['core'],
      expiresAt: body.expiresAt ?? null,
      companyName: body.companyName ?? null,
    };

    cache = { result, checkedAt: now };
    if (result.valid || result.inGracePeriod) lastValidAt = now;
    return result;
  } catch (err) {
    logger.warn('license check: CP unreachable', {
      error: err instanceof Error ? err.message : String(err),
    });

    // Offline tolerance: if last valid check < 24 h ago, keep valid
    if (lastValidAt && now - lastValidAt < OFFLINE_GRACE_MS) {
      logger.info('license check: offline grace — last valid check within 24h');
      return cache?.result ?? defaultResult();
    }

    // Beyond 24 h without a valid check -> invalid
    const expired: LicenseResult = {
      valid: false, inGracePeriod: false, features: [],
      expiresAt: null, companyName: null,
    };
    cache = { result: expired, checkedAt: now };
    return expired;
  }
}

/** Force clear cache (for testing). */
export function clearLicenseCache(): void {
  cache = null;
  lastValidAt = 0;
}
