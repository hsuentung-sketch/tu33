import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import * as inventoryService from './inventory.service.js';

export const inventoryRouter = Router();

const adjustSchema = z.object({
  delta: z.number().int(),
  reason: z.enum(['SALES_OUT', 'PURCHASE_IN', 'ADJUSTMENT', 'INITIAL']),
  note: z.string().optional(),
});

const reorderSchema = z.object({
  value: z.number().int().nonnegative(),
});

inventoryRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lowStockOnly = req.query.lowStockOnly === 'true';
    const rows = await inventoryService.list(req.tenantId, { lowStockOnly });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await inventoryService.getInventory(req.tenantId, String(req.params.productId));
    res.json(row);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get(
  '/:productId/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const txns = await inventoryService.listTransactions(
        req.tenantId,
        String(req.params.productId),
        limit,
      );
      res.json(txns);
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.post(
  '/:productId/adjust',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = adjustSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await inventoryService.adjust(
        req.tenantId,
        String(req.params.productId),
        parsed.data.delta,
        parsed.data.reason,
        { note: parsed.data.note, createdBy: req.employee?.id },
      );
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.put(
  '/:productId/reorder-point',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = reorderSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await inventoryService.setReorderPoint(
        req.tenantId,
        String(req.params.productId),
        parsed.data.value,
      );
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);
