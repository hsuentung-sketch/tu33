import { Router, type Request, type Response, type NextFunction } from 'express';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import * as commissionService from './commission.service.js';

export const commissionRouter = Router();

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING', 'SALES'];

/**
 * GET /commission/monthly?year=&month=&employeeId=&deductPct=
 * 業績獎金月結報表。
 * - SALES：強制只看自己（忽略 employeeId query）。
 * - ADMIN / ACCOUNTING：可帶 employeeId（省略 = 全部業務）。
 * - 其他角色：403。
 */
commissionRouter.get('/monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.employee?.role ?? '';
    if (!ALLOWED_ROLES.includes(role)) {
      throw new ForbiddenError('沒權限：僅 ADMIN / 會計 / 業務可查業績獎金');
    }
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      throw new ValidationError('year 參數錯誤');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new ValidationError('month 參數錯誤（1-12）');
    }
    const deductPct = req.query.deductPct ? Number(req.query.deductPct) : 0;

    // SALES 強制自己；ADMIN/ACCOUNTING 可選 employeeId
    let employeeId: string | undefined;
    if (role === 'SALES') {
      employeeId = req.employee.id;
    } else {
      employeeId =
        typeof req.query.employeeId === 'string' && req.query.employeeId
          ? req.query.employeeId
          : undefined;
    }

    const report = await commissionService.getMonthlyReport(req.tenantId, {
      year,
      month,
      employeeId,
      deductPct,
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});
