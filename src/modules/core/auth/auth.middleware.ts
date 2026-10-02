import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../../../shared/errors.js';
import { getTenantSettings, type TenantSettings } from '../../../shared/utils.js';
import { runWithAuditContext } from '../../../shared/audit.js';
import { updateRequestContext } from '../../../shared/error-log.js';
import { liffAuthMiddleware } from './liff-auth.middleware.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../../../config/index.js';
import { verifySessionToken } from './session-token.js';

const SESSION_COOKIE = 'ep_session';

// ---- Express type augmentation ----
declare global {
  namespace Express {
    interface Request {
      tenantId: string;
      employee: {
        id: string;
        employeeId: string;
        name: string;
        role: Role;
        lineUserId: string | null;
      };
      tenantSettings: TenantSettings;
    }
  }
}

/**
 * Primary request auth. Accepts either:
 *   - `Authorization: Bearer <LIFF ID token>` (LIFF browser clients)
 *   - web console `ep_session` cookie
 *   - `x-tenant-id` + `x-employee-id` + `x-internal-key` headers (server-to-server; disabled unless
 *     INTERNAL_API_KEY is set — the two ids alone are identifiers, not credentials)
 *
 * LIFF is tried first because that's the default path for LINE clients.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.header('authorization')?.startsWith('Bearer ')) {
    return liffAuthMiddleware(req, res, next);
  }
  // Web console cookie session, set by /api/auth/web/login.
  const cookies = (req as any).cookies as Record<string, string> | undefined;
  if (cookies && cookies[SESSION_COOKIE]) {
    return cookieAuthMiddleware(req, res, next);
  }
  return headerAuthMiddleware(req, res, next);
}

async function cookieAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = (req as any).cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedError('Missing session cookie');
    // Typed + shape-checked: a PDF/doc download token must never pass as a session.
    const decoded = verifySessionToken(token);
    if (!decoded) throw new UnauthorizedError('Session expired, please re-login');
    const employee = await prisma.employee.findFirst({
      where: { id: decoded.employeeId, tenantId: decoded.tenantId, isActive: true },
      include: { tenant: true },
    });
    if (!employee) throw new UnauthorizedError('Employee not found or inactive');
    if (!employee.tenant.isActive) throw new ForbiddenError('Tenant is inactive');

    req.tenantId = employee.tenantId;
    req.employee = {
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      role: employee.role,
      lineUserId: employee.lineUserId,
    };
    req.tenantSettings = getTenantSettings(employee.tenant.settings);

    updateRequestContext({ tenantId: employee.tenantId, userId: employee.id });
    runWithAuditContext({ tenantId: employee.tenantId, userId: employee.id }, async () => {
      next();
    }).catch(next);
  } catch (err) {
    next(err);
  }
}

/** Constant-time compare (both sides hashed first so length differences leak nothing). */
function internalKeyMatches(provided: string | undefined): boolean {
  const expected = config.internalApiKey;
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function headerAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!internalKeyMatches(req.header('x-internal-key'))) {
      throw new UnauthorizedError('Missing or invalid credentials');
    }
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    const employeeId = req.headers['x-employee-id'] as string | undefined;

    if (!tenantId || !employeeId) {
      throw new UnauthorizedError('Missing tenant or employee identification');
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId, isActive: true },
      include: { tenant: true },
    });

    if (!employee) {
      throw new UnauthorizedError('Employee not found or inactive');
    }

    if (!employee.tenant.isActive) {
      throw new ForbiddenError('Tenant is inactive');
    }

    req.tenantId = tenantId;
    req.employee = {
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      role: employee.role,
      lineUserId: employee.lineUserId,
    };
    req.tenantSettings = getTenantSettings(employee.tenant.settings);

    updateRequestContext({ tenantId, userId: employee.id });
    runWithAuditContext({ tenantId, userId: employee.id }, async () => {
      next();
    }).catch(next);
  } catch (err) {
    next(err);
  }
}

/**
 * Role-based permission guard. Must be used after authMiddleware.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.employee) {
      return next(new UnauthorizedError());
    }
    if (!roles.includes(req.employee.role)) {
      return next(new ForbiddenError('Insufficient role permissions'));
    }
    next();
  };
}
