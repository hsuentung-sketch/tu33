import { Router, type Request, type Response, type NextFunction } from 'express';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import * as commissionService from './commission.service.js';

export const commissionRouter = Router();

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING', 'SALES'];

/**
 * GET /commission/monthly?year=&month=&employeeId=
 * 業績獎金月結報表（v2.16.0：毛利−營業稅，扣除率用各業務員工稅率）。
 * - SALES：強制只看自己；不回進價 / 毛利明細（只回每單獎金），避免洩漏成本。
 * - ADMIN / ACCOUNTING：須指定 employeeId（實發需該業務稅率）；回完整明細。
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

    // SALES：強制自己 + 不給明細；ADMIN/ACCOUNTING：指定 employeeId + 給完整明細
    let employeeId: string | undefined;
    let includeItemDetail: boolean;
    if (role === 'SALES') {
      employeeId = req.employee.id;
      includeItemDetail = false;
    } else {
      employeeId =
        typeof req.query.employeeId === 'string' && req.query.employeeId
          ? req.query.employeeId
          : undefined;
      includeItemDetail = true;
    }

    const report = await commissionService.getMonthlyReport(req.tenantId, {
      year,
      month,
      employeeId,
      includeItemDetail,
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});
