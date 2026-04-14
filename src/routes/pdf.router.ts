/**
 * Public PDF download routes. No LIFF id-token required — instead each
 * link carries a short-lived JWT produced by signPdfToken(). This lets
 * users tap a link from the LINE chat and download the PDF directly.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
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

function tokenFor(req: Request) {
  const t = req.query.token;
  return typeof t === 'string' ? t : null;
}

pdfRouter.get('/:kind/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = tokenFor(req);
    if (!token) return res.status(401).send('Missing token');

    const payload = verifyPdfToken(token);
    if (!payload) return res.status(401).send('Invalid or expired token');

    const { kind } = req.params as { kind: string };
    const { id } = req.params as { id: string };
    if (payload.k !== kind || payload.i !== id) {
      return res.status(403).send('Token does not match document');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: payload.t } });
    if (!tenant) return res.status(404).send('Tenant not found');
    const settings = getTenantSettings(tenant.settings);

    if (kind === 'quotation') {
      const q = await prisma.quotation.findFirst({
        where: { id, tenantId: payload.t },
        include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
      });
      if (!q) return res.status(404).send('Quotation not found');
      const doc = generateQuotationPdf({
        companyHeader: settings.companyHeader || tenant.companyName,
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
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="quotation-${q.quotationNo}.pdf"`);
      doc.pipe(res);
      doc.end();
      return;
    }

    if (kind === 'sales-order') {
      const o = await prisma.salesOrder.findFirst({
        where: { id, tenantId: payload.t },
        include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
      });
      if (!o) return res.status(404).send('Sales order not found');
      const doc = generateSalesOrderPdf({
        companyHeader: settings.companyHeader || tenant.companyName,
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
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="sales-${o.orderNo}.pdf"`);
      doc.pipe(res);
      doc.end();
      return;
    }

    if (kind === 'purchase-order') {
      const o = await prisma.purchaseOrder.findFirst({
        where: { id, tenantId: payload.t },
        include: { items: { orderBy: { sortOrder: 'asc' } }, supplier: true },
      });
      if (!o) return res.status(404).send('Purchase order not found');
      const doc = generatePurchaseOrderPdf({
        companyHeader: settings.companyHeader || tenant.companyName,
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
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="purchase-${o.orderNo}.pdf"`);
      doc.pipe(res);
      doc.end();
      return;
    }

    return res.status(400).send('Unknown document kind');
  } catch (err) {
    logger.error('PDF render failed', { error: (err as Error).message });
    next(err);
  }
});
