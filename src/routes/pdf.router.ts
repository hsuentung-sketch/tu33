/**
 * Public PDF download routes. No LIFF id-token required — instead each
 * link carries a short-lived JWT produced by signPdfToken(). This lets
 * users tap a link from the LINE chat and download the PDF directly.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type PDFDocument from 'pdfkit';
import { prisma } from '../shared/prisma.js';
import { verifyPdfToken } from '../documents/pdf-link.js';
import {
  generateQuotationPdf,
  generateSalesOrderPdf,
  generatePurchaseOrderPdf,
} from '../documents/pdf-generator.js';
import { getTenantSettings } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export const pdfRouter = Router();

function tokenFor(req: Request): string | null {
  const t = req.query.token;
  return typeof t === 'string' ? t : null;
}

/**
 * Send a PDFDocument on the response with all error paths covered.
 * PDFKit emits 'error' asynchronously on font/layout problems — if that
 * event is not handled Node tears the process down.
 */
function streamPdf(
  res: Response,
  next: NextFunction,
  filename: string,
  build: () => InstanceType<typeof PDFDocument>,
) {
  let doc: InstanceType<typeof PDFDocument>;
  try {
    doc = build();
  } catch (err) {
    logger.error('PDF build threw', { error: (err as Error).message });
    return next(err);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.on('error', (err: Error) => {
    logger.error('PDFKit stream error', { error: err.message });
    if (!res.headersSent) {
      res.status(500).send('PDF generation failed');
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  });
  doc.pipe(res);
  try {
    doc.end();
  } catch (err) {
    logger.error('PDF end threw', { error: (err as Error).message });
    if (!res.headersSent) next(err);
  }
}

pdfRouter.get('/:kind/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = tokenFor(req);
    if (!token) return res.status(401).send('Missing token');

    const payload = verifyPdfToken(token);
    if (!payload) return res.status(401).send('Invalid or expired token');

    const { kind, id } = req.params as { kind: string; id: string };
    if (payload.k !== kind || payload.i !== id) {
      return res.status(403).send('Token does not match document');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: payload.t } });
    if (!tenant) return res.status(404).send('Tenant not found');
    const settings = getTenantSettings(tenant.settings);
    const companyHeader = settings.companyHeader || tenant.companyName;

    if (kind === 'quotation') {
      const q = await prisma.quotation.findFirst({
        where: { id, tenantId: payload.t },
        include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
      });
      if (!q) return res.status(404).send('Quotation not found');
      return streamPdf(res, next, `quotation-${q.quotationNo}.pdf`, () =>
        generateQuotationPdf({
          companyHeader,
          quotationNo: q.quotationNo,
          date: q.createdAt,
          customer: {
            name: q.customer.name,
            contactName: q.customer.contactName,
            zipCode: q.customer.zipCode,
            address: q.customer.address,
          },
          salesPerson: q.salesPerson,
          salesPhone: q.salesPhone,
          items: q.items.map((it) => ({
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.amount,
            note: it.note,
          })),
          subtotal: Number(q.subtotal),
          taxAmount: Number(q.taxAmount),
          totalAmount: Number(q.totalAmount),
          supplyTime: q.supplyTime,
          paymentTerms: q.paymentTerms,
          validUntil: q.validUntil,
          note: q.note,
          pdfFooter: settings.pdfFooter,
          isDraft: q.status === 'DRAFT',
        }),
      );
    }

    if (kind === 'sales-order') {
      const o = await prisma.salesOrder.findFirst({
        where: { id, tenantId: payload.t },
        include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
      });
      if (!o) return res.status(404).send('Sales order not found');
      return streamPdf(res, next, `sales-${o.orderNo}.pdf`, () =>
        generateSalesOrderPdf({
          companyHeader,
          orderNo: o.orderNo,
          date: o.orderDate,
          customer: {
            name: o.customer.name,
            contactName: o.customer.contactName,
            taxId: o.customer.taxId,
            phone: o.customer.phone,
            address: o.customer.address,
          },
          salesPerson: o.salesPerson,
          salesPhone: o.salesPhone,
          deliveryNote: o.deliveryNote,
          items: o.items.map((it) => ({
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.amount,
            note: it.note,
          })),
          subtotal: Number(o.subtotal),
          taxAmount: Number(o.taxAmount),
          totalAmount: Number(o.totalAmount),
          deliveredBy: o.deliveredBy,
          receivedBy: o.receivedBy,
          pdfFooter: settings.pdfFooter,
        }),
      );
    }

    if (kind === 'purchase-order') {
      const o = await prisma.purchaseOrder.findFirst({
        where: { id, tenantId: payload.t },
        include: { items: { orderBy: { sortOrder: 'asc' } }, supplier: true },
      });
      if (!o) return res.status(404).send('Purchase order not found');
      return streamPdf(res, next, `purchase-${o.orderNo}.pdf`, () =>
        generatePurchaseOrderPdf({
          companyHeader,
          orderNo: o.orderNo,
          date: o.orderDate,
          supplier: {
            name: o.supplier.name,
            contactName: o.supplier.contactName,
            taxId: o.supplier.taxId,
            phone: o.supplier.phone,
            address: o.supplier.address,
          },
          internalStaff: o.internalStaff,
          staffPhone: o.staffPhone,
          deliveryNote: o.deliveryNote,
          items: o.items.map((it) => ({
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.amount,
            note: it.note,
            referenceCost: it.referenceCost == null ? null : Number(it.referenceCost),
          })),
          subtotal: Number(o.subtotal),
          taxAmount: Number(o.taxAmount),
          totalAmount: Number(o.totalAmount),
          pdfFooter: settings.pdfFooter,
        }),
      );
    }

    return res.status(400).send('Unknown document kind');
  } catch (err) {
    logger.error('PDF route error', { error: (err as Error).message, stack: (err as Error).stack });
    next(err);
  }
});
