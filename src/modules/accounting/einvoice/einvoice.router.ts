import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors.js';
import { requireAdmin } from '../../core/auth/require-admin.js';
import { prisma } from '../../../shared/prisma.js';
import { getTenantSettings } from '../../../shared/utils.js';
import { generateProofPdf } from '../../../documents/einvoice-proof-pdf.js';
import { generateB2BEinvoicePdf } from '../../../documents/einvoice-b2b-pdf.js';
import { logger } from '../../../shared/logger.js';
import * as einvoiceService from './einvoice.service.js';

export const einvoiceRouter = Router();

const itemSchema = z.object({
  sequence: z.number().int().positive().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  unitPrice: z.number().nonnegative(),
  amount: z.number().nonnegative().optional(),
});

const issueSchema = z.object({
  receivableId: z.string().optional(),
  salesOrderId: z.string().optional(),
  buyerTaxId: z.string().nullable().optional(),
  buyerName: z.string().min(1, '請填寫買受人名稱'),
  buyerAddress: z.string().optional(),
  items: z.array(itemSchema).min(1, '至少一個品項'),
  // MIG 4.1：新增 "4"=應稅(特種稅率)
  taxType: z.enum(['1', '2', '3', '4']).optional(),
  invoiceDate: z.coerce.date().optional(),
  carrierType: z.string().optional(),
  carrierId: z.string().optional(),
  npoban: z.string().optional(),
  printFlag: z.enum(['Y', 'N']).optional(),
  // MIG 4.1 新增
  mainRemark: z.string().max(200).optional(),
  customsClearanceMark: z.enum(['1', '2']).optional(),
  zeroTaxRateReason: z.string().max(60).optional(),
  // 分支機構字軌隔離（自行檢測表項 9(3)）；總公司省略或填 null
  branchId: z.string().nullable().optional(),
});

const voidSchema = z.object({
  reason: z.string().min(1, '請填寫作廢原因'),
});

einvoiceRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const salesOrderId = req.query.salesOrderId ? String(req.query.salesOrderId) : undefined;
    const receivableId = req.query.receivableId ? String(req.query.receivableId) : undefined;
    res.json(await einvoiceService.list(req.tenantId, { status, salesOrderId, receivableId }));
  } catch (err) { next(err); }
});

einvoiceRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await einvoiceService.getById(req.tenantId, String(req.params.id)));
  } catch (err) { next(err); }
});

einvoiceRouter.get('/:id/xml', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = req.query.kind === 'void' ? 'void' : 'issue';
    const xml = await einvoiceService.readXml(req.tenantId, String(req.params.id), kind);
    if (xml == null) {
      res.status(404).send('XML not found');
      return;
    }
    res.type('application/xml').send(xml);
  } catch (err) { next(err); }
});

einvoiceRouter.get('/:id/proof.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const inv = await prisma.einvoice.findFirst({
      where: { id, tenantId: req.tenantId },
      include: { items: { orderBy: { sequence: 'asc' } }, salesOrder: { select: { orderNo: true } } },
    });
    if (!inv) { res.status(404).send('Not found'); return; }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant) { res.status(404).send('Tenant not found'); return; }
    const settings = getTenantSettings(tenant.settings);
    const cfg = settings.einvoice;

    // 依買方統編分派：B2B（有 8 碼統編）走 A5 證明聯（蓋發票章）；
    // B2C 走 80mm 熱感紙（barcode + dual QR）
    const isB2B = !!inv.buyerTaxId && /^\d{8}$/.test(inv.buyerTaxId);

    const doc = isB2B
      ? await generateB2BEinvoicePdf({
          invoiceNo: inv.invoiceNo,
          invoiceDate: inv.invoiceDate,
          randomCode: inv.randomCode || '0000',
          invoiceFormat: '25',
          // B2B 證明聯：賣方資訊一律以「公司資料」為準（tenant.companyName /
          // tenant.taxId / tenant.address），不被 einvoice.sellerName 等覆蓋。
          // 上方頁眉的公司名同樣抓 tenant.companyName，確保一致。
          sellerName: tenant.companyName,
          sellerTaxId: tenant.taxId || cfg.sellerTaxId || '',
          sellerAddress: tenant.address || cfg.sellerAddress || undefined,
          buyerName: inv.buyerName || '',
          buyerTaxId: inv.buyerTaxId,
          buyerAddress: inv.buyerAddress || undefined,
          taxType: inv.taxType || '1',
          salesAmount: Number(inv.salesAmount),
          taxAmount: Number(inv.taxAmount),
          totalAmount: Number(inv.totalAmount),
          items: inv.items.map((it) => ({
            description: it.description,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            amount: Number(it.amount),
          })),
          salesOrderNo: inv.salesOrder?.orderNo,
          voided: inv.status === 'voided',
          tenantId: req.tenantId,
          stampOpacity: settings.invoiceStamp?.opacity ?? 0.85,
          aesKeyHex: cfg.qrAesKey || '',
        })
      : await generateProofPdf({
          invoiceNo: inv.invoiceNo,
          invoiceDate: inv.invoiceDate,
          randomCode: inv.randomCode || '0000',
          salesAmount: Number(inv.salesAmount),
          taxAmount: Number(inv.taxAmount),
          totalAmount: Number(inv.totalAmount),
          buyerTaxId: inv.buyerTaxId,
          buyerName: inv.buyerName,
          // 賣方一律取自「公司資料」，不再讀 settings.einvoice.seller* override
          sellerTaxId: tenant.taxId || '',
          sellerName: tenant.companyName,
          sellerAddress: tenant.address || undefined,
          aesKeyHex: cfg.qrAesKey || '',
          voided: inv.status === 'voided',
          printFlag: inv.printFlag,
          items: inv.items.map((it) => ({
            description: it.description,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            amount: Number(it.amount),
          })),
        });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="einvoice-${inv.invoiceNo}.pdf"`);
    doc.on('error', (err: Error) => {
      logger.error('einvoice proof pdf error', { error: err.message });
      if (!res.headersSent) res.status(500).send('PDF generation failed');
      else { try { res.end(); } catch { /* ignore */ } }
    });
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

einvoiceRouter.post('/issue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可開立電子發票');
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const created = await einvoiceService.issue(req.tenantId, {
      ...parsed.data,
      createdBy: req.employee.id,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

einvoiceRouter.post('/:id/void', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req, '僅 ADMIN 可作廢電子發票');
    const parsed = voidSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const voided = await einvoiceService.voidInvoice(
      req.tenantId, String(req.params.id), parsed.data.reason, req.employee.id,
    );
    res.json(voided);
  } catch (err) { next(err); }
});
