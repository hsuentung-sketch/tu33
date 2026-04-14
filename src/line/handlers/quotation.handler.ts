import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import { runWithAuditContext } from '../../shared/audit.js';
import * as quotationService from '../../modules/sales/quotation/quotation.service.js';

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

    default:
      logger.warn(`Unknown quotation action: ${action}`);
  }
}
