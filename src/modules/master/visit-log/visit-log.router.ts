/**
 * 工作日誌 router。Mount on `/api/visit-logs`（已過 authMiddleware）。
 *
 * 權限：
 *  - 所有角色都可讀寫自己的 visit log
 *  - SALES 列表自動 filter createdByEmployeeId = self；單筆 read/update/delete 走 canSalesAccess
 *  - ADMIN / ACCOUNTING / VIEWER 列表無 filter，但 VIEWER 不可寫
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import * as service from './visit-log.service.js';

export const visitLogRouter = Router();

const createSchema = z.object({
  visitDate: z.coerce.date(),
  customerId: z.string().min(1),
  content: z.string().min(1),
  nextActionDate: z.coerce.date().nullable().optional(),
});

const updateSchema = z.object({
  visitDate: z.coerce.date().optional(),
  customerId: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  nextActionDate: z.coerce.date().nullable().optional(),
});

visitLogRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.employee;
    const fromQ = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    const toQ = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
    const employeeIdQ = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : undefined;

    // SALES: force self-scope regardless of employeeId query
    const employeeId = me?.role === 'SALES' ? me.id : employeeIdQ;

    const logs = await service.list(req.tenantId, {
      from: fromQ,
      to: toQ,
      customerId,
      employeeId,
      limit,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

visitLogRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.employee;
    const log = await service.getById(req.tenantId, String(req.params.id));
    if (me?.role === 'SALES' && !service.canSalesAccess(log, me.id)) {
      throw new ForbiddenError('沒權限：只能查看自己建立的日誌');
    }
    res.json(log);
  } catch (err) {
    next(err);
  }
});

visitLogRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.employee;
    if (me?.role === 'VIEWER') throw new ForbiddenError('VIEWER 不可寫');
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const log = await service.create(req.tenantId, {
      ...parsed.data,
      createdByEmployeeId: me?.id ?? null,
    });
    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

visitLogRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.employee;
    if (me?.role === 'VIEWER') throw new ForbiddenError('VIEWER 不可寫');
    const log = await service.getById(req.tenantId, String(req.params.id));
    if (me?.role === 'SALES' && !service.canSalesAccess(log, me.id)) {
      throw new ForbiddenError('沒權限：只能修改自己建立的日誌');
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const updated = await service.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

visitLogRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.employee;
    if (me?.role === 'VIEWER') throw new ForbiddenError('VIEWER 不可寫');
    const log = await service.getById(req.tenantId, String(req.params.id));
    if (me?.role === 'SALES' && !service.canSalesAccess(log, me.id)) {
      throw new ForbiddenError('沒權限：只能刪除自己建立的日誌');
    }
    await service.remove(req.tenantId, String(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
