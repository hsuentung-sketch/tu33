import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../../../shared/errors.js';
import { getTenantSettings, type TenantSettings } from '../../../shared/utils.js';
import { runWithAuditContext } from '../../../shared/audit.js';
import { liffAuthMiddleware } from './liff-auth.middleware.js';

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
 *   - `x-tenant-id` + `x-employee-id` headers (server-to-server / admin tools)
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
  return headerAuthMiddleware(req, res, next);
}

async function headerAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
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
