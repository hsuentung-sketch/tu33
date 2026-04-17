import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import * as productService from './product.service.js';
import * as productDocService from './product-document.service.js';

export const productRouter = Router();

// In-memory buffer, capped at 10 MB. Product docs are small PDFs/images.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const DOC_TYPES = ['PDS', 'SDS', 'DM', 'OTHER'] as const;

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

// -------- Product documents (PDS / SDS / DM / OTHER) --------

productRouter.get(
  '/:id/documents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docs = await productDocService.list(req.tenantId, String(req.params.id));
      res.json(docs);
    } catch (err) {
      next(err);
    }
  },
);

productRouter.post(
  '/:id/documents',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) throw new ValidationError('缺少 file 欄位');
      const type = String(req.body?.type || '').toUpperCase();
      if (!DOC_TYPES.includes(type as (typeof DOC_TYPES)[number])) {
        throw new ValidationError(`type 必須為 ${DOC_TYPES.join(' / ')}`);
      }
      const doc = await productDocService.upload({
        tenantId: req.tenantId,
        productId: String(req.params.id),
        type: type as productDocService.DocumentType,
        fileName: file.originalname,
        mimeType: file.mimetype,
        bytes: file.buffer,
        uploadedBy: req.employee.id,
      });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

productRouter.delete(
  '/:id/documents/:docId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await productDocService.remove(req.tenantId, String(req.params.docId));
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
