import { createHmac } from 'node:crypto';
import cron from 'node-cron';
import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';
import * as versionService from '../modules/core/version/version.service.js';

/**
 * Daily version auto-upgrade Cron job (V0.12.0 F.3 extended)
 *
 * Part A: poll CP release manifest — check if a new release is available.
 * Part B: original autoUpgradeExpiredVersions() — upgrade tenants past deadline.
 *
 * Runs daily 10:00 Asia/Taipei.
 */

// ---------- Part A: CP release manifest poll ----------

interface ReleaseManifest {
  version: string;
  commit: string;
  releasedAt: string;
  message: string;
  minClientVersion: string | null;
  migrationNotes: string | null;
  signature: string;
  signatureAlgorithm: string;
}

function verifyManifestSignature(manifest: ReleaseManifest, signingKey: string): boolean {
  if (!signingKey) return true; // no key -> trust HTTPS
  try {
    const { signature, signatureAlgorithm, ...payload } = manifest;
    if (signatureAlgorithm !== 'hmac-sha256') {
      logger.warn('release manifest: unknown signature algorithm', { signatureAlgorithm });
      return false;
    }
    const expected = createHmac('sha256', signingKey)
      .update(JSON.stringify(payload))
      .digest('hex');
    return expected === signature;
  } catch (err) {
    logger.warn('release manifest: signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function pollCpReleaseManifest(): Promise<void> {
  const { baseUrl, releaseSigningKey } = config.controlPlane;
  if (!baseUrl) {
    logger.debug('release poll: CP_BASE_URL not set, skipping');
    return;
  }

  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/platform/releases/latest`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });

    if (res.status === 404) {
      logger.info('release poll: no releases published yet on CP');
      return;
    }
    if (!res.ok) {
      logger.warn('release poll: CP responded', { status: res.status });
      return;
    }

    const manifest = await res.json() as ReleaseManifest;

    // Verify signature if key is configured
    if (releaseSigningKey && !verifyManifestSignature(manifest, releaseSigningKey)) {
      logger.error('release poll: SIGNATURE MISMATCH — manifest may be tampered', {
        version: manifest.version,
      });
      return;
    }

    // Compare with local build commit
    const localCommit = process.env.GIT_COMMIT || process.env.FLY_MACHINE_VERSION || '';
    const remoteCommit = manifest.commit?.slice(0, 7) || manifest.version;

    if (localCommit && remoteCommit && localCommit.startsWith(remoteCommit.slice(0, 7))) {
      logger.info('release poll: up to date', { version: manifest.version });
    } else {
      logger.info('release poll: NEW VERSION AVAILABLE', {
        remote: manifest.version,
        remoteCommit: manifest.commit,
        localCommit: localCommit || '(unknown)',
        message: manifest.message,
        releasedAt: manifest.releasedAt,
        minClientVersion: manifest.minClientVersion,
        migrationNotes: manifest.migrationNotes,
      });
      // Future: could trigger LINE push notification to operator here
    }
  } catch (err) {
    logger.warn('release poll: CP unreachable', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------- Part B: original auto-upgrade ----------

export async function runDailyVersionAutoUpgrade(now: Date = new Date()): Promise<void> {
  logger.info('Starting daily version auto-upgrade job', { timestamp: now.toISOString() });

  // Part A — poll CP release manifest
  await pollCpReleaseManifest();

  // Part B — auto-upgrade expired tenants
  try {
    const results = await versionService.autoUpgradeExpiredVersions();

    logger.info('Daily version auto-upgrade completed', {
      upgraded: results.upgraded,
      failed: results.failed,
      timestamp: now.toISOString(),
    });

    if (results.details.length > 0) {
      logger.info('Auto-upgraded tenants', { details: results.details });
    }
  } catch (err) {
    logger.error('Daily version auto-upgrade job failed', {
      error: err instanceof Error ? err.message : String(err),
      timestamp: now.toISOString(),
    });
  }
}

/**
 * Schedule the version auto-upgrade at 10:00 Asia/Taipei every day.
 */
export function scheduleDailyVersionAutoUpgrade(): void {
  cron.schedule('0 10 * * *', () => {
    runDailyVersionAutoUpgrade().catch((err) => {
      logger.error('Daily version auto-upgrade crashed', { error: err });
    });
  }, { timezone: 'Asia/Taipei' });
  logger.info('Daily version auto-upgrade scheduled: daily 10:00 Asia/Taipei');
}
