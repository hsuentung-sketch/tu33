import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import { runWithAuditContext } from '../../shared/audit.js';
import * as session from '../session.js';

/**
 * Accounting: LINE flows for AR/AP listing + mark-paid.
 * Uses session.data.pendingItem.productName as a scratch field to stash the pending record id
 * while we wait for the user's invoice number input.
 */
export async function handleAccountingCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, params, employee } = ctx;
  const lineUserId = employee.lineUserId;

  switch (action) {
    case 'accounting:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '帳務管理',
          template: {
            type: 'buttons',
            title: '帳務管理',
            text: '請選擇查詢類型',
            actions: [
              { type: 'postback', label: '應收 - 未收款', data: 'action=accounting:ar-unpaid' },
              { type: 'postback', label: '應付 - 未付款', data: 'action=accounting:ap-unpaid' },
              { type: 'postback', label: '應收 - 逾期', data: 'action=accounting:ar-overdue' },
              { type: 'postback', label: '應付 - 逾期', data: 'action=accounting:ap-overdue' },
            ],
          },
        }],
      });
      return;

    case 'accounting:ar-unpaid':
    case 'accounting:ar-overdue': {
      const overdue = action === 'accounting:ar-overdue';
      const where: any = { tenantId, isPaid: false };
      if (overdue) where.dueDate = { lt: new Date() };
      const rows = await prisma.accountReceivable.findMany({
        where,
        include: { customer: { select: { name: true } }, salesOrder: { select: { orderNo: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      });
      if (rows.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: overdue ? '無逾期應收帳款。' : '無未收應收帳款。' }],
        });
        return;
      }
      const header = overdue ? '🚨 逾期應收（最多 10 筆）' : '📋 未收應收（最多 10 筆）';
      const text = rows.map((r, i) => {
        const days = Math.floor((Date.now() - r.dueDate.getTime()) / 86400000);
        const badge = days > 0 ? `逾期 ${days} 天` : `${-days} 天到期`;
        return `${i + 1}. ${r.salesOrder.orderNo} ${r.customer.name} $${Number(r.amount).toLocaleString('zh-TW')} [${badge}]`;
      }).join('\n');
      const actions = rows.slice(0, 4).map((r) => ({
        type: 'postback' as const,
        label: `入帳 ${r.salesOrder.orderNo}`.slice(0, 20),
        data: `action=accounting:ar-pay&id=${r.id}`,
      }));
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: `${header}\n${text}` },
          {
            type: 'template',
            altText: '選擇要入帳的單',
            template: { type: 'buttons', title: '標記入帳', text: '點選要標記入帳的單', actions },
          },
        ],
      });
      return;
    }

    case 'accounting:ap-unpaid':
    case 'accounting:ap-overdue': {
      const overdue = action === 'accounting:ap-overdue';
      const where: any = { tenantId, isPaid: false };
      if (overdue) where.dueDate = { lt: new Date() };
      const rows = await prisma.accountPayable.findMany({
        where,
        include: { supplier: { select: { name: true } }, purchaseOrder: { select: { orderNo: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      });
      if (rows.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: overdue ? '無逾期應付帳款。' : '無未付應付帳款。' }],
        });
        return;
      }
      const header = overdue ? '🚨 逾期應付（最多 10 筆）' : '📋 未付應付（最多 10 筆）';
      const text = rows.map((r, i) => {
        const days = Math.floor((Date.now() - r.dueDate.getTime()) / 86400000);
        const badge = days > 0 ? `逾期 ${days} 天` : `${-days} 天到期`;
        return `${i + 1}. ${r.purchaseOrder.orderNo} ${r.supplier.name} $${Number(r.amount).toLocaleString('zh-TW')} [${badge}]`;
      }).join('\n');
      const actions = rows.slice(0, 4).map((r) => ({
        type: 'postback' as const,
        label: `付款 ${r.purchaseOrder.orderNo}`.slice(0, 20),
        data: `action=accounting:ap-pay&id=${r.id}`,
      }));
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: `${header}\n${text}` },
          {
            type: 'template',
            altText: '選擇要付款的單',
            template: { type: 'buttons', title: '標記付款', text: '點選要標記付款的單', actions },
          },
        ],
      });
      return;
    }

    case 'accounting:ar-pay':
    case 'accounting:ap-pay': {
      const id = params.get('id');
      if (!id) return;
      const isAR = action === 'accounting:ar-pay';
      const s = session.start(tenantId, lineUserId, isAR ? 'ar:pay' : 'ap:pay');
      s.step = 'items';
      s.data.pendingItem = { productName: id }; // stash record id
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `請輸入發票號碼（或輸入「無」略過）：` }],
      });
      return;
    }

    default:
      logger.warn(`Unknown accounting action: ${action}`);
  }
}

/**
 * Mid-flow text consumer for AR/AP invoice entry.
 */
export async function handleAccountingText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  const s = session.get(tenantId, lineUserId);
  if (!s) return false;
  const flow = s.flow as string;
  if (flow !== 'ar:pay' && flow !== 'ap:pay') return false;

  const id = s.data.pendingItem?.productName as unknown as string;
  if (!id) {
    session.clear(tenantId, lineUserId);
    return false;
  }

  const invoiceNo = text === '無' ? null : text.trim();

  try {
    if (flow === 'ar:pay') {
      await runWithAuditContext({ tenantId, userId: employee.id }, () =>
        prisma.accountReceivable.update({
          where: { id },
          data: { isPaid: true, paidDate: new Date(), invoiceNo },
        }),
      );
    } else {
      await runWithAuditContext({ tenantId, userId: employee.id }, () =>
        prisma.accountPayable.update({
          where: { id },
          data: { isPaid: true, paidDate: new Date(), invoiceNo },
        }),
      );
    }
    session.clear(tenantId, lineUserId);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `✅ 已標記${flow === 'ar:pay' ? '入帳' : '付款'}${invoiceNo ? `（發票：${invoiceNo}）` : ''}`,
      }],
    });
  } catch (err) {
    session.clear(tenantId, lineUserId);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `更新失敗：${(err as Error).message}` }],
    });
  }
  return true;
}
