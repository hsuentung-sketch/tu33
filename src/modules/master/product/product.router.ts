import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as productService from './product.service.js';

export const productRouter = Router();

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  salePrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative(),
  note: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  salePrice: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

productRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, includeInactive } = req.query;
    if (typeof q === 'string' && q.length > 0) {
      const products = await productService.findByNameOrCode(req.tenantId, q);
      return res.json(products);
    }
    const products = await productService.list(req.tenantId, {
      includeInactive: includeInactive === 'true',
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

productRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await productService.getById(req.tenantId, String(req.params.id));
    res.json(product);
  } catch (err) {
    next(err);
  }
});

productRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const product = await productService.create(req.tenantId, parsed.data);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

productRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const product = await productService.update(req.tenantId, String(req.params.id), parsed.data);
    res.json(product);
  } catch (err) {
    next(err);
  }
});

productRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await productService.deactivate(req.tenantId, String(req.params.id));
    res.json(product);
  } catch (err) {
    next(err);
  }
});
