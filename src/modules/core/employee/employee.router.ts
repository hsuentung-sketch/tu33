import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as employeeService from './employee.service.js';

export const employeeRouter = Router();

const createSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING', 'VIEWER']).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTING', 'VIEWER']).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
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
    const employee = await employeeService.update(req.tenantId, String(req.params.id), parsed.data);
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
