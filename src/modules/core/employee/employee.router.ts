import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ForbiddenError, ValidationError } from '../../../shared/errors.js';
import * as employeeService from './employee.service.js';

export const employeeRouter = Router();

function requireAdmin(req: Request) {
  if (req.employee.role !== 'ADMIN') {
    throw new ForbiddenError('僅 ADMIN 可操作員工密碼');
  }
}

const passwordSchema = z.string().min(8, '密碼至少 8 碼');

const createSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING', 'VIEWER']).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  password: passwordSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING', 'VIEWER']).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  // Password mutation: undefined = no change; string = reset; null = remove.
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

employeeRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    // Only ADMIN may set a password on creation; non-ADMIN silently omits it.
    if (parsed.data.password !== undefined) requireAdmin(req);
    const employee = await employeeService.create(req.tenantId, parsed.data);
    res.status(201).json(employee);
  } catch (err) {
    next(err);
  }
});

employeeRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { password, ...rest } = parsed.data;
    // Non-password fields go through the generic update.
    if (Object.keys(rest).length) {
      await employeeService.update(req.tenantId, String(req.params.id), rest);
    }
    // Password mutation is gated to ADMIN only.
    if (password !== undefined) {
      requireAdmin(req);
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

employeeRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await employeeService.deactivate(req.tenantId, String(req.params.id));
    res.json(employee);
  } catch (err) {
    next(err);
  }
});
