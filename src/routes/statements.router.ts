import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../modules/core/auth/auth.middleware.js';
import { runMonthlyStatements } from '../jobs/monthly-statement.js';
import { ValidationError } from '../shared/errors.js';

export const statementsRouter = Router();

statementsRouter.post(
  '/run',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { year, month } = req.body ?? {};
      if (
        typeof year !== 'number' ||
        typeof month !== 'number' ||
        month < 1 ||
        month > 12
      ) {
        throw new ValidationError('year and month are required (month 1-12)');
      }
      await runMonthlyStatements(year, month, req.tenantId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
