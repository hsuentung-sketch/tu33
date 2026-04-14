import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, ForbiddenError } from '../../../shared/errors.js';
import { authMiddleware, requireRole } from './auth.middleware.js';
import { createBindingCode } from './auth.service.js';

export const authRouter = Router();

const bindSchema = z.object({ employeeId: z.string().min(1) });

/**
 * Admin generates a binding code for an employee.
 * The employee then sends `綁定 XXXXXX` to the LINE bot.
 */
authRouter.post(
  '/bind/code',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = bindSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      // An admin can only mint codes for their own tenant.
      if (req.employee.role !== 'ADMIN') throw new ForbiddenError();
      const result = await createBindingCode(req.tenantId, parsed.data.employeeId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
