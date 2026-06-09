import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import { runWithAuditContext } from '../../shared/audit.js';
import * as quotationService from '../../modules/sales/quotation/quotation.service.js';
import { generateQuotationPdf } from '../../documents/pdf-generator.js';
import { sendDocumentEmail } from '../../documents/email-sender.js';
import { getTenantSettings } from '../../shared/utils.js';
import { buildPdfShortUrl } from '../../documents/pdf-shortlink.js';
import { config } from '../../config/index.js';

async function buildQuotationPdfBuffer(tenantId: string, quotationId: string): Promise<{ buffer: Buffer; filename: string; quotationNo: string; customer: { name: string; email: string | null } } | null> {
  const q = await prisma.quotation.findFirst({
    where: { id: quotationId, tenantId },
    include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
  });
  if (!q) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = getTenantSettings(tenant?.settings);
  // 抬頭一律以「公司資料」為準，不再讀 settings.companyHeader override
  const companyHeader = tenant?.companyName || '';

  const doc = generateQuotationPdf({
    companyHeader,
    companyTaxId: tenant?.taxId ?? null,
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
            ],
          },
        }],
      });
      return;

    case 'quotation:list': {
      const where: any = { tenantId };
      if (employee?.role === 'SALES') where.createdBy = employee.id;
      const rows = await prisma.quotation.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      if (rows.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '尚無報價單。' }],
        });
        return;
      }
      // Build Flex carousel with PDF + edit + convert + cancel buttons per quotation
      const adminBase = config.publicBaseUrl.replace(/\/$/, '') + '/admin/';
      const bubbles = [];
      for (const r of rows.slice(0, 10)) {
        const pdfUrl = await buildPdfShortUrl({
          tenantId,
          kind: 'quotation',
          id: r.id,
          label: `quotation-${r.quotationNo}.pdf`,
          createdBy: employee.id,
        });
        const isActive = r.status !== 'CANCELLED' && r.status !== 'LOST' && r.status !== 'WON';
        // Row 1: PDF download + edit (admin link)
        const row1: any[] = [
          { type: 'button', style: 'primary', height: 'sm', color: '#1DB446',
            action: { type: 'uri', label: 'PDF', uri: pdfUrl } },
        ];
        if (isActive) {
          row1.push({ type: 'button', style: 'link', height: 'sm',
            action: { type: 'uri', label: '編輯（後台）', uri: `${adminBase}#quotations` } });
        }
        // Row 2: convert + cancel (only for active quotations)
        const row2: any[] = [];
        if (isActive) {
          row2.push({ type: 'button', style: 'primary', height: 'sm', color: '#0066CC',
            action: { type: 'postback', label: '轉銷貨單', data: `action=quotation:convert&id=${r.id}` } });
          row2.push({ type: 'button', style: 'primary', height: 'sm', color: '#CC3333',
            action: { type: 'postback', label: '取消報價', data: `action=quotation:cancel&id=${r.id}` } });
        }
        const footerContents: any[] = [
          { type: 'box', layout: 'horizontal', spacing: 'sm', contents: row1 },
        ];
        if (row2.length > 0) {
          footerContents.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: row2 });
        }
        bubbles.push({
          type: 'bubble',
          size: 'kilo',
          body: {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: [
              { type: 'text', text: r.quotationNo, weight: 'bold', size: 'md' },
              { type: 'text', text: r.customer.name, size: 'sm', color: '#555555' },
              { type: 'text', text: `$${Number(r.totalAmount).toLocaleString('zh-TW')}  [${r.status}]`, size: 'sm', color: '#888888' },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: footerContents,
          },
        });
      }
      const messages: any[] = [{
        type: 'flex',
        altText: `最近 ${rows.length} 筆報價單`,
        contents: { type: 'carousel', contents: bubbles },
      }];
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

    case 'quotation:cancel': {
      const id = params.get('id');
      if (!id) return;
      try {
        await runWithAuditContext(
          { tenantId, userId: employee.id },
          () => quotationService.softDelete(tenantId, id, employee.id),
        );
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '✅ 報價單已取消。' }],
        });
      } catch (err) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `取消失敗：${(err as Error).message}` }],
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
