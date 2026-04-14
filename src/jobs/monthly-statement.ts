import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../shared/logger.js';
import { getTenantSettings } from '../shared/utils.js';
import {
  generateCustomerStatementPdf,
  generateSupplierStatementPdf,
  pdfToBuffer,
} from '../documents/statement-pdf.js';
import { sendDocumentEmail } from '../documents/email-sender.js';

// Read-only job running outside any request context.
const db = new PrismaClient({ log: ['error'] });

function formatPeriod(year: number, month: number): string {
  return `${year}/${String(month).padStart(2, '0')}`;
}

/**
 * Monthly statement generation. For each active tenant:
 * - Email each Customer (with email) their AR for the billing period.
 * - Email each Supplier (with email) their AP for the billing period.
 */
export async function runMonthlyStatements(
  year: number,
  month: number,
  tenantFilter?: string,
): Promise<void> {
  const tenants = await db.tenant.findMany({
    where: {
      isActive: true,
      ...(tenantFilter ? { id: tenantFilter } : {}),
    },
  });

  const period = formatPeriod(year, month);

  for (const tenant of tenants) {
    const settings = getTenantSettings(tenant.settings);
    const companyHeader = settings.companyHeader || tenant.companyName;
    const pdfFooter = settings.pdfFooter;

    // Customers → AR
    const customers = await db.customer.findMany({
      where: { tenantId: tenant.id, isActive: true, email: { not: null } },
    });

    for (const customer of customers) {
      if (!customer.email) continue;

      const receivables = await db.accountReceivable.findMany({
        where: {
          tenantId: tenant.id,
          customerId: customer.id,
          billingYear: year,
          billingMonth: month,
        },
        include: { salesOrder: { select: { orderNo: true, orderDate: true } } },
        orderBy: { dueDate: 'asc' },
      });

      if (receivables.length === 0) continue;

      const rows = receivables.map((r) => ({
        orderNo: r.salesOrder.orderNo,
        orderDate: r.salesOrder.orderDate,
        amount: r.amount,
        dueDate: r.dueDate,
        isPaid: r.isPaid,
      }));

      const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
      const paidAmount = rows
        .filter((r) => r.isPaid)
        .reduce((s, r) => s + Number(r.amount), 0);
      const unpaidAmount = totalAmount - paidAmount;

      try {
        const doc = generateCustomerStatementPdf({
          companyHeader,
          period,
          customer: {
            name: customer.name,
            taxId: customer.taxId,
            address: customer.address,
            phone: customer.phone,
          },
          rows,
          totalAmount,
          paidAmount,
          unpaidAmount,
          pdfFooter,
        });
        const pdfBuffer = await pdfToBuffer(doc);

        const subject = `${tenant.companyName} ${period} 對帳單`;
        const body =
          `${customer.name} 您好：\n\n` +
          `附件為 ${period} 月對帳單，本期應收合計 $${totalAmount.toLocaleString('zh-TW')}，` +
          `未收合計 $${unpaidAmount.toLocaleString('zh-TW')}。\n\n` +
          `若有疑義請與我們聯繫，謝謝。\n\n${tenant.companyName}`;

        await sendDocumentEmail({
          to: customer.email,
          subject,
          body,
          pdfBuffer,
          pdfFilename: `statement-${period.replace('/', '')}-${customer.name}.pdf`,
        });
        logger.info('Customer statement sent', {
          tenantId: tenant.id,
          customerId: customer.id,
          period,
        });
      } catch (err) {
        logger.error('Customer statement failed', {
          tenantId: tenant.id,
          customerId: customer.id,
          period,
          error: err,
        });
      }
    }

    // Suppliers → AP
    const suppliers = await db.supplier.findMany({
      where: { tenantId: tenant.id, isActive: true, email: { not: null } },
    });

    for (const supplier of suppliers) {
      if (!supplier.email) continue;

      const payables = await db.accountPayable.findMany({
        where: {
          tenantId: tenant.id,
          supplierId: supplier.id,
          billingYear: year,
          billingMonth: month,
        },
        include: { purchaseOrder: { select: { orderNo: true, orderDate: true } } },
        orderBy: { dueDate: 'asc' },
      });

      if (payables.length === 0) continue;

      const rows = payables.map((p) => ({
        orderNo: p.purchaseOrder.orderNo,
        orderDate: p.purchaseOrder.orderDate,
        amount: p.amount,
        dueDate: p.dueDate,
        isPaid: p.isPaid,
      }));

      const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
      const paidAmount = rows
        .filter((r) => r.isPaid)
        .reduce((s, r) => s + Number(r.amount), 0);
      const unpaidAmount = totalAmount - paidAmount;

      try {
        const doc = generateSupplierStatementPdf({
          companyHeader,
          period,
          supplier: {
            name: supplier.name,
            taxId: supplier.taxId,
            address: supplier.address,
            phone: supplier.phone,
          },
          rows,
          totalAmount,
          paidAmount,
          unpaidAmount,
          pdfFooter,
        });
        const pdfBuffer = await pdfToBuffer(doc);

        const subject = `${tenant.companyName} ${period} 對帳單`;
        const body =
          `${supplier.name} 您好：\n\n` +
          `附件為 ${period} 月對帳單，本期應付合計 $${totalAmount.toLocaleString('zh-TW')}，` +
          `未付合計 $${unpaidAmount.toLocaleString('zh-TW')}。\n\n` +
          `若有疑義請與我們聯繫，謝謝。\n\n${tenant.companyName}`;

        await sendDocumentEmail({
          to: supplier.email,
          subject,
          body,
          pdfBuffer,
          pdfFilename: `statement-${period.replace('/', '')}-${supplier.name}.pdf`,
        });
        logger.info('Supplier statement sent', {
          tenantId: tenant.id,
          supplierId: supplier.id,
          period,
        });
      } catch (err) {
        logger.error('Supplier statement failed', {
          tenantId: tenant.id,
          supplierId: supplier.id,
          period,
          error: err,
        });
      }
    }
  }
}

/**
 * Schedule monthly statements on the 1st of each month at 09:30 Asia/Taipei,
 * generating for the previous month.
 */
export function scheduleMonthlyStatements(): void {
  cron.schedule(
    '30 9 1 * *',
    () => {
      const now = new Date();
      // Previous month in local (server) time; cron fires in Asia/Taipei.
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = prev.getFullYear();
      const month = prev.getMonth() + 1;
      runMonthlyStatements(year, month).catch((err) => {
        logger.error('Monthly statement crashed', { error: err });
      });
    },
    { timezone: 'Asia/Taipei' },
  );
  logger.info('Monthly statement scheduled: 1st of each month 09:30 Asia/Taipei');
}
