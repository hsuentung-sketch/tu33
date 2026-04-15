import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import { runWithAuditContext } from '../../shared/audit.js';
import * as quotationService from '../../modules/sales/quotation/quotation.service.js';
import { generateQuotationPdf } from '../../documents/pdf-generator.js';
import { sendDocumentEmail } from '../../documents/email-sender.js';
import { getTenantSettings } from '../../shared/utils.js';

async function buildQuotationPdfBuffer(tenantId: string, quotationId: string): Promise<{ buffer: Buffer; filename: string; quotationNo: string; customer: { name: string; email: string | null } } | null> {
  const q = await prisma.quotation.findFirst({
    where: { id: quotationId, tenantId },
    include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
  });
  if (!q) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);
  const companyHeader = settings.companyHeader || tenant?.companyName || '';

  const doc = generateQuotationPdf({
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
  });

  const chunks: Buffer[] = [];
  const buffer: Buffer = await new Promise((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

  return {
    buffer,
    filename: `quotation-${q.quotationNo}.pdf`,
    quotationNo: q.quotationNo,
    customer: { name: q.customer.name, email: q.customer.email },
  };
}

/**
 * Quotation handler: list recent quotations + one-tap convert to sales order.
 * Full quotation creation is via LIFF form at /liff/quotation.html.
 */
export async function handleQuotationCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;

  switch (action) {
    case 'quotation:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '報價管理',
          template: {
            type: 'buttons',
            title: '報價管理',
            text: '請選擇操作',
            actions: [
              { type: 'uri', label: '新增（LIFF）', uri: 'https://liff.line.me/2009797959-uDVN0eGQ' },
              { type: 'postback', label: '最近報價', data: 'action=quotation:list' },
              { type: 'postback', label: '追蹤中', data: 'action=quotation:tracking' },
            ],
          },
        }],
      });
      return;

    case 'quotation:list':
    case 'quotation:tracking': {
      const where: any = { tenantId };
      if (action === 'quotation:tracking') {
        where.status = { in: ['SENT', 'TRACKING'] };
      }
      const rows = await prisma.quotation.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (rows.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '尚無報價單。' }],
        });
        return;
      }
      const text = rows.map((r, i) =>
        `${i + 1}. ${r.quotationNo} ${r.customer.name} $${Number(r.totalAmount).toLocaleString('zh-TW')} [${r.status}]`,
      ).join('\n');
      const actions = rows
        .filter((r) => r.status !== 'CANCELLED' && r.status !== 'LOST')
        .slice(0, 4)
        .map((r) => ({
          type: 'postback' as const,
          label: `轉銷貨 ${r.quotationNo}`.slice(0, 20),
          data: `action=quotation:convert&id=${r.id}`,
        }));
      const messages: any[] = [{ type: 'text', text: `📋 最近 5 筆報價：\n${text}` }];
      if (actions.length > 0) {
        messages.push({
          type: 'template',
          altText: '轉為銷貨單',
          template: { type: 'buttons', title: '報價轉銷貨', text: '選擇要成交轉為銷貨單的報價', actions },
        });
      }
      await client.replyMessage({ replyToken: event.replyToken, messages });
      return;
    }

    case 'quotation:convert': {
      const id = params.get('id');
      if (!id) return;
      try {
        const order = await runWithAuditContext(
          { tenantId, userId: employee.id },
          () => quotationService.convertToSalesOrder(tenantId, id, employee.id),
        );
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `✅ 報價已轉為銷貨單\n單號：${order.orderNo}\n總計：$${Number(order.totalAmount).toLocaleString('zh-TW')}`,
          }],
        });
      } catch (err) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `轉換失敗：${(err as Error).message}` }],
        });
      }
      return;
    }

    case 'quotation:email-skip': {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消寄送 Email。' }],
      });
      return;
    }

    case 'quotation:email': {
      const id = params.get('id');
      if (!id) return;
      try {
        const pdf = await buildQuotationPdfBuffer(tenantId, id);
        if (!pdf) {
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: '找不到報價單。' }],
          });
          return;
        }
        if (!pdf.customer.email) {
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: `客戶「${pdf.customer.name}」沒有 Email，請先到客戶管理補填。` }],
          });
          return;
        }
        await sendDocumentEmail({
          to: pdf.customer.email,
          subject: `報價單 ${pdf.quotationNo}`,
          body: `您好，\n\n附件為本次報價單 ${pdf.quotationNo}，請查收。\n\n謝謝！`,
          pdfBuffer: pdf.buffer,
          pdfFilename: pdf.filename,
        });
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✉️ 已寄送報價單至 ${pdf.customer.email}` }],
        });
      } catch (err) {
        logger.error('Send quotation email failed', { error: (err as Error).message });
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `寄送失敗：${(err as Error).message}` }],
        });
      }
      return;
    }

    default:
      logger.warn(`Unknown quotation action: ${action}`);
  }
}
