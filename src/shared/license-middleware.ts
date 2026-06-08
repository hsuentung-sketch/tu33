/**
 * License middleware (V0.12.0 F.3)
 *
 * Checks CP license validity on each request (with 1h in-memory cache).
 *
 * Behaviour:
 *  - LICENSE_KEY not set -> skip (dev mode, no enforcement)
 *  - valid=true -> pass through
 *  - inGracePeriod=true -> pass through + X-License-Grace header
 *  - valid=false + GET request -> pass through (readonly mode)
 *  - valid=false + non-GET request -> 403
 */
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { checkLicense } from './license-check.js';
import { logger } from './logger.js';

export async function licenseMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Dev mode: no license key -> skip entirely
  if (!config.controlPlane.licenseKey) {
    next();
    return;
  }

  try {
    const license = await checkLicense();

    if (license.valid && !license.inGracePeriod) {
      next();
      return;
    }

    if (license.inGracePeriod) {
      res.setHeader('X-License-Grace', 'true');
      if (license.expiresAt) {
        res.setHeader('X-License-Expires', license.expiresAt);
      }
      next();
      return;
    }

    // valid=false: allow GET (readonly) but block mutations
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      res.setHeader('X-License-Expired', 'true');
      next();
      return;
    }

    // Block write operations
    logger.warn('license middleware: blocked mutation (license expired)', {
      method: req.method,
      path: req.path,
    });
    res.status(403).json({
      error: {
        code: 'LICENSE_EXPIRED',
        message: '授權已過期，系統進入唯讀模式。請聯繫管理員續約。',
      },
    });
  } catch (err) {
    // If license check itself throws unexpectedly, don't block the user
    logger.error('license middleware: unexpected error, allowing request', {
      error: err instanceof Error ? err.message : String(err),
    });
    next();
  }
}
