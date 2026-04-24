import type { Request } from 'express';
import { ForbiddenError } from '../../../shared/errors.js';

/**
 * Throw ForbiddenError if the authenticated employee is not ADMIN.
 * Shared by employee password management, einvoice issuance, and other
 * ADMIN-gated operations so the check stays identical everywhere.
 */
export function requireAdmin(req: Request, message = '僅 ADMIN 可操作'): void {
  if (req.employee?.role !== 'ADMIN') {
    throw new ForbiddenError(message);
  }
}
