import { logger } from '../../shared/logger.js';
import * as session from '../session.js';
import { fuzzySearch } from '../../shared/search.js';
import { prisma } from '../../shared/prisma.js';
import * as salesOrderService from '../../modules/sales/sales-order/sales-order.service.js';
import * as productService from '../../modules/master/product/product.service.js';
import { runWithAuditContext } from '../../shared/audit.js';
import { buildPdfShortUrl } from '../../documents/pdf-shortlink.js';
import { sendItemConfirmCard } from './item-confirm.js';
import { makeSafeSend } from '../safe-send.js';

/**
 * Small helper: a "label: value" baseline row inside a Flex bubble.
 * Typed as `any` because @line/bot-sdk's Flex types are unwieldy here —
 * LINE happily accepts the shape we're producing.
 */
function infoRow(label: string, value: string): any {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#888888', flex: 2 },
      { type: 'text', text: value, size: 'sm', align: 'end', flex: 3 },
    ],
  };
}


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

    case 'sales:pick-product': {
      const name = params.get('name');
      const priceRaw = params.get('price');
      if (!name) return;
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'sales:create') return;
      const salePrice = Number(priceRaw) || 0;
      s.data.pendingProduct = { name, salePrice, costPrice: 0 };
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `✅ 已選：${name}\n建議售價：$${salePrice.toLocaleString('zh-TW')}\n\n請輸入：\n• 「數量 單價」例如：2 21000\n• 或只輸入「數量」使用建議售價`,
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

      // Order creation may span DB transaction + event handlers + PDF shortlink.
      // Use safeSend so a >30s delay falls back to push instead of losing the reply.
      const safeSend = makeSafeSend({
        client,
        replyToken: event.replyToken,
        lineUserId: employee.lineUserId,
        source: 'sales:confirm',
      });
      try {
        const order = await runWithAuditContext(
          { tenantId, userId: employee.id },
          () => salesOrderService.create(tenantId, {
            customerId: s.data.partyId!,
            salesPerson: employee.name,
            salesPhone: (employee as { phone?: string | null }).phone ?? undefined,
            deliveryNote: s.data.deliveryNote,
            createdBy: employee.id,
            items: s.data.items.map((it) => ({
              productName: it.productName,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              note: it.note,
            })),
          }),
        );
        session.clear(tenantId, lineUserId);
        const pdfUrl = await buildPdfShortUrl({
          tenantId,
          kind: 'sales-order',
          id: order.id,
          label: `sales-${order.orderNo}.pdf`,
          createdBy: employee.id,
        });
        await safeSend([{
          type: 'text',
          text: `✅ 銷貨單已建立\n單號：${order.orderNo}\n總計：$${Number(order.totalAmount).toLocaleString('zh-TW')}\n\n📄 sales-${order.orderNo}.pdf\n${pdfUrl}`,
        }]);
      } catch (err) {
        logger.error('Sales order create failed', { error: err });
        await safeSend([{ type: 'text', text: `建立失敗：${(err as Error).message}` }]);
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

    case 'sales:item-add-note': {
      const s = session.get(tenantId, lineUserId);
      if (!s?.data.pendingItem) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '沒有待確認的品項，請重新輸入。' }],
        });
        return;
      }
      s.step = 'item-await-note';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '請輸入備註文字（或輸入「取消」返回）：' }],
      });
      return;
    }

    case 'sales:item-confirm': {
      const s = session.get(tenantId, lineUserId);
      const pi = s?.data.pendingItem;
      if (!s || !pi) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '沒有待確認的品項。' }],
        });
        return;
      }
      s.data.items.push({
        productName: pi.productName!,
        quantity: pi.quantity!,
        unitPrice: pi.unitPrice!,
        note: pi.note,
      });
      s.data.pendingItem = undefined;
      s.step = 'items';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `已加入：${pi.productName} × ${pi.quantity} @ $${Number(pi.unitPrice).toLocaleString('zh-TW')}${pi.note ? `\n備註：${pi.note}` : ''}\n目前 ${s.data.items.length} 筆。繼續新增或輸入「完成」確認。`,
        }],
      });
      return;
    }

    case 'sales:item-cancel': {
      const s = session.get(tenantId, lineUserId);
      if (s) {
        s.data.pendingItem = undefined;
        s.step = 'items';
        session.set(tenantId, lineUserId, s);
      }
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消此品項。可繼續輸入下一筆或「完成」。' }],
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
      const fmtDate = (d: Date) =>
        `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      const bubbles = await Promise.all(orders.map(async (o) => {
        const pdfUrl = await buildPdfShortUrl({
          tenantId,
          kind: 'sales-order',
          id: o.id,
          label: `sales-${o.orderNo}.pdf`,
          createdBy: employee.id,
        });
        return {
          type: 'bubble',
          size: 'kilo',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'text', text: o.orderNo, weight: 'bold', size: 'md' },
              { type: 'text', text: o.customer.name, size: 'sm', color: '#555555', wrap: true },
              { type: 'separator', margin: 'sm' },
              {
                type: 'box', layout: 'baseline', spacing: 'sm', contents: [
                  { type: 'text', text: '日期', size: 'xs', color: '#888888', flex: 2 },
                  { type: 'text', text: fmtDate(o.orderDate), size: 'sm', align: 'end', flex: 3 },
                ],
              },
              {
                type: 'box', layout: 'baseline', spacing: 'sm', contents: [
                  { type: 'text', text: '總計', size: 'xs', color: '#888888', flex: 2 },
                  { type: 'text', text: `$${Number(o.totalAmount).toLocaleString('zh-TW')}`, size: 'sm', align: 'end', flex: 3 },
                ],
              },
              {
                type: 'box', layout: 'baseline', spacing: 'sm', contents: [
                  { type: 'text', text: '狀態', size: 'xs', color: '#888888', flex: 2 },
                  { type: 'text', text: o.status, size: 'sm', align: 'end', flex: 3 },
                ],
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [{
              type: 'button',
              style: 'primary',
              color: '#06c755',
              height: 'sm',
              action: { type: 'uri', label: `sales-${o.orderNo}.pdf`.slice(0, 20), uri: pdfUrl },
            }],
          },
        };
      }));
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: '最近銷貨單',
          contents: { type: 'carousel', contents: bubbles },
        }] as never,
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

  if (s.step === 'item-await-note') {
    if (text === '取消') {
      s.step = 'items';
      s.data.pendingItem = undefined;
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消備註輸入。可繼續輸入品項或「完成」。' }],
      });
      return true;
    }
    const pi = s.data.pendingItem;
    if (!pi || !pi.productName || pi.quantity == null || pi.unitPrice == null) {
      s.step = 'items';
      session.set(tenantId, lineUserId, s);
      return false;
    }
    pi.note = text;
    s.step = 'items';
    session.set(tenantId, lineUserId, s);
    await sendItemConfirmCard(client, event.replyToken, 'sales', pi as { productName: string; quantity: number; unitPrice: number; note?: string });
    return true;
  }

  if (s.step === 'await-delivery-note') {
    const trimmed = text.trim();
    const skip = ['無', '跳過', 'skip', 'none'].includes(trimmed.toLowerCase());
    s.data.deliveryNote = skip ? undefined : trimmed;
    s.step = 'confirm';
    session.set(tenantId, lineUserId, s);
    const subtotal = s.data.items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;
    const summary = s.data.items
      .map((it, i) => `${i + 1}. ${it.productName} × ${it.quantity} @ $${it.unitPrice}`)
      .join('\n');
    const body =
      `客戶：${s.data.partyName}\n${summary}\n` +
      (s.data.deliveryNote ? `送貨備註：${s.data.deliveryNote}\n` : '') +
      `小計：$${subtotal.toLocaleString('zh-TW')}\n` +
      `稅：$${tax.toLocaleString('zh-TW')}\n` +
      `總計：$${total.toLocaleString('zh-TW')}`;
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'template',
        altText: '確認銷貨單',
        template: {
          type: 'confirm',
          text: body.slice(0, 240),
          actions: [
            { type: 'postback', label: '送出', data: 'action=sales:confirm' },
            { type: 'postback', label: '取消', data: 'action=sales:cancel' },
          ],
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
      // 新流程：先收送貨備註，再進 confirm 步驟。
      s.step = 'await-delivery-note';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '請輸入送貨備註（不需要請輸入「無」或「跳過」）：',
        }],
      });
      return true;
    }

    const parts = text.split(/\s+/);
    const allNumeric = parts.every((p) => Number.isFinite(Number(p.replace(/,/g, ''))));

    // Branch 1: a product was pre-selected from a search result. Expect
    // "<qty>" (auto-fill price) or "<qty> <price>".
    if (s.data.pendingProduct && allNumeric && (parts.length === 1 || parts.length === 2)) {
      const quantity = Number(parts[0]);
      const unitPrice = parts.length === 2
        ? Number(parts[1].replace(/,/g, ''))
        : s.data.pendingProduct.salePrice;
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice)) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '數量或單價無法解析，請重新輸入。' }],
        });
        return true;
      }
      const productName = s.data.pendingProduct.name;
      s.data.pendingProduct = undefined;
      s.data.pendingItem = { productName, quantity, unitPrice };
      session.set(tenantId, lineUserId, s);
      await sendItemConfirmCard(client, event.replyToken, 'sales', s.data.pendingItem as { productName: string; quantity: number; unitPrice: number; note?: string });
      return true;
    }

    // Branch 2: full-form "<品名> <數量> <單價>" — last two parts are
    // numeric and there's at least one word before them.
    if (parts.length >= 3) {
      const unitPrice = Number(parts[parts.length - 1].replace(/,/g, ''));
      const quantity = Number(parts[parts.length - 2]);
      if (Number.isFinite(unitPrice) && Number.isFinite(quantity) && quantity > 0) {
        const productName = parts.slice(0, parts.length - 2).join(' ');
        s.data.pendingItem = { productName, quantity, unitPrice };
        session.set(tenantId, lineUserId, s);
        await sendItemConfirmCard(client, event.replyToken, 'sales', s.data.pendingItem as { productName: string; quantity: number; unitPrice: number; note?: string });
        return true;
      }
    }

    // Branch 3: treat the whole text as a product-name search query and
    // reply with a flex carousel showing 建議售價 + 上次成交 + 交易日.
    const products = await productService.findByNameOrCode(tenantId, text);
    if (products.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `找不到符合「${text}」的產品。\n請輸入關鍵字（如 6336）或完整格式 <品名> <數量> <單價>。`,
        }],
      });
      return true;
    }

    // Look up each product's last sale to *this customer* so the card
    // can show "上次成交價 / 交易日" alongside the product master price.
    const names = products.map((p) => p.name);
    const recent = await prisma.salesItem.findMany({
      where: {
        productName: { in: names },
        salesOrder: { tenantId, customerId: s.data.partyId! },
      },
      include: { salesOrder: { select: { orderDate: true } } },
    });
    const lastByProduct = new Map<string, { unitPrice: number; date: Date }>();
    for (const it of recent) {
      const d = it.salesOrder.orderDate;
      const cur = lastByProduct.get(it.productName);
      if (!cur || d.getTime() > cur.date.getTime()) {
        lastByProduct.set(it.productName, { unitPrice: Number(it.unitPrice), date: d });
      }
    }

    const fmtDate = (d: Date) =>
      `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

    const bubbles = products.slice(0, 10).map((p) => {
      const last = lastByProduct.get(p.name);
      // Prefer last transaction price (more relevant to this customer);
      // fall back to product master salePrice.
      const suggest = last ? last.unitPrice : Number(p.salePrice);
      return {
        type: 'bubble',
        size: 'kilo',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: p.name, weight: 'bold', size: 'md', wrap: true },
            { type: 'separator', margin: 'sm' },
            infoRow('建議售價', `$${Number(p.salePrice).toLocaleString('zh-TW')}`),
            infoRow('上次成交', last ? `$${last.unitPrice.toLocaleString('zh-TW')}` : 'null'),
            infoRow('交易日', last ? fmtDate(last.date) : 'null'),
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'button',
            style: 'primary',
            color: '#06c755',
            height: 'sm',
            action: {
              type: 'postback',
              label: '選擇',
              data: `action=sales:pick-product&name=${encodeURIComponent(p.name)}&price=${suggest}`,
              displayText: `選擇 ${p.name}`,
            },
          }],
        },
      };
    });

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'flex',
        altText: `產品搜尋：${text}`,
        contents: { type: 'carousel', contents: bubbles },
      }] as never,
    });
    return true;
  }

  return false;
}
