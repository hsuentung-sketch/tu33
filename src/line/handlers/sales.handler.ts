import { logger } from '../../shared/logger.js';
import * as session from '../session.js';
import { fuzzySearch } from '../../shared/search.js';
import { prisma } from '../../shared/prisma.js';
import * as salesOrderService from '../../modules/sales/sales-order/sales-order.service.js';
import { runWithAuditContext } from '../../shared/audit.js';

/**
 * LINE command / postback handler for sales orders.
 * Supports a 3-step flow: select customer → add items → confirm.
 */
export async function handleSalesCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;
  const lineUserId = employee.lineUserId;

  switch (action) {
    case 'sales:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '銷貨管理',
          template: {
            type: 'buttons',
            title: '銷貨管理',
            text: '請選擇操作',
            actions: [
              { type: 'postback', label: '新增銷貨單', data: 'action=sales:new' },
              { type: 'postback', label: '銷貨紀錄', data: 'action=sales:list' },
            ],
          },
        }],
      });
      return;

    case 'sales:new': {
      session.start(tenantId, lineUserId, 'sales:create');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '請輸入客戶關鍵字以搜尋（例如：毅金）',
        }],
      });
      return;
    }

    case 'sales:pick-customer': {
      const customerId = params.get('id');
      const customerName = params.get('name');
      if (!customerId || !customerName) return;
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'sales:create') return;
      s.data.partyId = customerId;
      s.data.partyName = customerName;
      s.step = 'items';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `客戶：${customerName}\n\n請輸入品項，格式：\n<品名> <數量> <單價>\n例：EK-C-215 2 17200\n\n完成後輸入「完成」確認。`,
        }],
      });
      return;
    }

    case 'sales:confirm': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'sales:create' || !s.data.partyId || s.data.items.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '沒有可送出的銷貨單。' }],
        });
        return;
      }

      try {
        const order = await runWithAuditContext(
          { tenantId, userId: employee.id },
          () => salesOrderService.create(tenantId, {
            customerId: s.data.partyId!,
            salesPerson: employee.name,
            createdBy: employee.id,
            items: s.data.items.map((it) => ({
              productName: it.productName,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
            })),
          }),
        );
        session.clear(tenantId, lineUserId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `✅ 銷貨單已建立\n單號：${order.orderNo}\n總計：$${Number(order.totalAmount).toLocaleString('zh-TW')}`,
          }],
        });
      } catch (err) {
        logger.error('Sales order create failed', { error: err });
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `建立失敗：${(err as Error).message}` }],
        });
      }
      return;
    }

    case 'sales:cancel': {
      session.clear(tenantId, lineUserId);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消。' }],
      });
      return;
    }

    case 'sales:list': {
      const orders = await prisma.salesOrder.findMany({
        where: { tenantId },
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (orders.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '尚無銷貨紀錄。' }],
        });
        return;
      }
      const text = orders.map((o, i) =>
        `${i + 1}. ${o.orderNo} ${o.customer.name} $${Number(o.totalAmount).toLocaleString('zh-TW')} [${o.status}]`,
      ).join('\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `最近 5 筆銷貨單：\n${text}` }],
      });
      return;
    }

    default:
      logger.warn(`Unknown sales action: ${action}`);
  }
}

/**
 * Called from text-message routing when user is mid-flow in a sales session.
 * Returns true if this handler consumed the text.
 */
export async function handleSalesText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'sales:create') return false;

  if (s.step === 'party') {
    const results = await fuzzySearch(tenantId, text);
    const customers = results.filter((r) => r.type === 'customer').slice(0, 5);
    if (customers.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `找不到客戶「${text}」。請換個關鍵字，或輸入「取消」結束。` }],
      });
      return true;
    }
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'template',
        altText: '選擇客戶',
        template: {
          type: 'buttons',
          title: '選擇客戶',
          text: '請點選一個客戶',
          actions: customers.slice(0, 4).map((c) => ({
            type: 'postback' as const,
            label: c.name.slice(0, 20),
            data: `action=sales:pick-customer&id=${c.id}&name=${encodeURIComponent(c.name)}`,
          })),
        },
      }],
    });
    return true;
  }

  if (s.step === 'items') {
    if (text === '取消') {
      session.clear(tenantId, lineUserId);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消。' }],
      });
      return true;
    }
    if (text === '完成') {
      if (s.data.items.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '請先輸入至少一筆品項。' }],
        });
        return true;
      }
      s.step = 'confirm';
      session.set(tenantId, lineUserId, s);
      const subtotal = s.data.items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
      const tax = Math.round(subtotal * 0.05);
      const total = subtotal + tax;
      const summary = s.data.items
        .map((it, i) => `${i + 1}. ${it.productName} × ${it.quantity} @ $${it.unitPrice}`)
        .join('\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '確認銷貨單',
          template: {
            type: 'confirm',
            text: `客戶：${s.data.partyName}\n${summary}\n小計：$${subtotal.toLocaleString('zh-TW')}\n稅：$${tax.toLocaleString('zh-TW')}\n總計：$${total.toLocaleString('zh-TW')}`.slice(0, 240),
            actions: [
              { type: 'postback', label: '送出', data: 'action=sales:confirm' },
              { type: 'postback', label: '取消', data: 'action=sales:cancel' },
            ],
          },
        }],
      });
      return true;
    }

    // Parse "<品名> <數量> <單價>"
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '格式錯誤。請輸入：<品名> <數量> <單價>' }],
      });
      return true;
    }
    const unitPrice = Number(parts[parts.length - 1].replace(/,/g, ''));
    const quantity = Number(parts[parts.length - 2]);
    const productName = parts.slice(0, parts.length - 2).join(' ');
    if (!Number.isFinite(unitPrice) || !Number.isFinite(quantity) || quantity <= 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '數量或單價無法解析，請重新輸入。' }],
      });
      return true;
    }
    s.data.items.push({ productName, quantity, unitPrice });
    session.set(tenantId, lineUserId, s);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `已加入：${productName} × ${quantity} @ $${unitPrice}\n目前 ${s.data.items.length} 筆。繼續新增或輸入「完成」確認。`,
      }],
    });
    return true;
  }

  return false;
}
