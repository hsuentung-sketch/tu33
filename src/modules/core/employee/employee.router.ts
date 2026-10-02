import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import * as employeeService from './employee.service.js';

export const employeeRouter = Router();

// 員工異動（含角色、密碼、停用）一律限 ADMIN；否則任何人可把自己升為 ADMIN。
function adminOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.employee?.role !== 'ADMIN') return next(new ForbiddenError('沒權限：僅 ADMIN 可異動員工資料'));
  next();
}

const passwordSchema = z.string().min(8, '密碼至少 8 碼');

const bankFields = {
  bankCode: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  bankBranch: z.string().nullable().optional(),
  bankAccountName: z.string().nullable().optional(),
  bankAccountNo: z.string().nullable().optional(),
};

const createSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING', 'VIEWER']).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  notes: z.string().nullable().optional(),
  taxDeductRate: z.number().min(0).max(100).nullable().optional(),
  ...bankFields,
  password: passwordSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING', 'VIEWER']).optional(),
  phone: z.string().nullable().optional(),
  email: z.union([z.string().email(), z.literal(''), z.null()])
    .optional()
    .transform((v) => v === '' ? null : v),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  taxDeductRate: z.number().min(0).max(100).nullable().optional(),
  ...bankFields,
  password: z.union([passwordSchema, z.null()]).optional(),
});

employeeRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const employees = await employeeService.list(req.tenantId, { includeInactive });
    res.json(employees);
  } catch (err) {
    next(err);
  }
});

employeeRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await employeeService.getById(req.tenantId, String(req.params.id));
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

employeeRouter.post('/', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const employee = await employeeService.create(req.tenantId, parsed.data);
    res.status(201).json(employee);
  } catch (err) {
    next(err);
  }
});

employeeRouter.put('/:id', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { password, ...rest } = parsed.data;
    // Trim notes; empty string → null
    if (typeof rest.notes === 'string') rest.notes = rest.notes.trim() || null;
    // Non-password fields go through the generic update.
    if (Object.keys(rest).length) {
      await employeeService.update(req.tenantId, String(req.params.id), rest);
    }
    if (password !== undefined) {
      if (password === null) {
        await employeeService.clearPassword(req.tenantId, String(req.params.id));
      } else {
        await employeeService.setPassword(req.tenantId, String(req.params.id), password);
      }
    }
    const employee = await employeeService.getById(req.tenantId, String(req.params.id));
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

employeeRouter.delete('/:id', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await employeeService.deactivate(req.tenantId, String(req.params.id));
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

employeeRouter.post('/:id/activate', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await employeeService.activate(req.tenantId, String(req.params.id));
    res.json(employee);
  } catch (err) {
    next(err);
  }
});
