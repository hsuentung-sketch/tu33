import { logger } from '../../shared/logger.js';
import * as session from '../session.js';
import { fuzzySearch } from '../../shared/search.js';
import { prisma } from '../../shared/prisma.js';
import * as purchaseOrderService from '../../modules/purchase/purchase-order/purchase-order.service.js';
import * as productService from '../../modules/master/product/product.service.js';
import { runWithAuditContext } from '../../shared/audit.js';
import { signPdfToken, buildPdfUrl } from '../../documents/pdf-link.js';
import { config } from '../../config/index.js';

/** See sales.handler.ts for rationale. */
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
 * LINE command / postback handler for purchase orders.
 * 3-step flow: select supplier → add items → confirm.
 */
export async function handlePurchaseCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;
  const lineUserId = employee.lineUserId;

  switch (action) {
    case 'purchase:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '進貨管理',
          template: {
            type: 'buttons',
            title: '進貨管理',
            text: '請選擇操作',
            actions: [
              { type: 'postback', label: '新增進貨單', data: 'action=purchase:new' },
              { type: 'postback', label: '進貨紀錄', data: 'action=purchase:list' },
            ],
          },
        }],
      });
      return;

    case 'purchase:new': {
      session.start(tenantId, lineUserId, 'purchase:create');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '請輸入供應商關鍵字以搜尋（例如：示範）',
        }],
      });
      return;
    }

    case 'purchase:pick-supplier': {
      const supplierId = params.get('id');
      const supplierName = params.get('name');
      if (!supplierId || !supplierName) return;
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'purchase:create') return;
      s.data.partyId = supplierId;
      s.data.partyName = supplierName;
      s.step = 'items';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `供應商：${supplierName}\n\n請輸入品項，格式：\n<品名> <數量> <單價>\n例：EK-C-215 10 12000\n\n完成後輸入「完成」確認。`,
        }],
      });
      return;
    }

    case 'purchase:pick-product': {
      const name = params.get('name');
      const costRaw = params.get('cost');
      if (!name) return;
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'purchase:create') return;
      const costPrice = Number(costRaw) || 0;
      s.data.pendingProduct = { name, salePrice: 0, costPrice };
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `✅ 已選：${name}\n參考進價：$${costPrice.toLocaleString('zh-TW')}\n\n請輸入：\n• 「數量 單價」例如：10 12000\n• 或只輸入「數量」使用參考進價`,
        }],
      });
      return;
    }

    case 'purchase:confirm': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'purchase:create' || !s.data.partyId || s.data.items.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '沒有可送出的進貨單。' }],
        });
        return;
      }

      try {
        const order = await runWithAuditContext(
          { tenantId, userId: employee.id },
          () => purchaseOrderService.create(tenantId, {
            supplierId: s.data.partyId!,
            internalStaff: employee.name,
            createdBy: employee.id,
            items: s.data.items.map((it) => ({
              productName: it.productName,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
            })),
          }),
        );
        session.clear(tenantId, lineUserId);
        const pdfUrl = buildPdfUrl(
          config.publicBaseUrl,
          'purchase-order',
          order.id,
          signPdfToken(tenantId, 'purchase-order', order.id),
        );
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `✅ 進貨單已建立\n單號：${order.orderNo}\n總計：$${Number(order.totalAmount).toLocaleString('zh-TW')}\n\n📄 下載 PDF：\n${pdfUrl}`,
          }],
        });
      } catch (err) {
        logger.error('Purchase order create failed', { error: err });
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `建立失敗：${(err as Error).message}` }],
        });
      }
      return;
    }

    case 'purchase:cancel': {
      session.clear(tenantId, lineUserId);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消。' }],
      });
      return;
    }

    case 'purchase:list': {
      const orders = await prisma.purchaseOrder.findMany({
        where: { tenantId },
        include: { supplier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (orders.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '尚無進貨紀錄。' }],
        });
        return;
      }
      const text = orders.map((o, i) =>
        `${i + 1}. ${o.orderNo} ${o.supplier.name} $${Number(o.totalAmount).toLocaleString('zh-TW')} [${o.status}]`,
      ).join('\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `最近 5 筆進貨單：\n${text}` }],
      });
      return;
    }

    default:
      logger.warn(`Unknown purchase action: ${action}`);
  }
}

/**
 * Text consumer for mid-flow purchase sessions.
 */
export async function handlePurchaseText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'purchase:create') return false;

  if (s.step === 'party') {
    const results = await fuzzySearch(tenantId, text, { types: ['supplier'] });
    const suppliers = results.filter((r) => r.type === 'supplier').slice(0, 5);
    if (suppliers.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `找不到供應商「${text}」。請換個關鍵字，或輸入「取消」結束。` }],
      });
      return true;
    }
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'template',
        altText: '選擇供應商',
        template: {
          type: 'buttons',
          title: '選擇供應商',
          text: '請點選一個供應商',
          actions: suppliers.slice(0, 4).map((c) => ({
            type: 'postback' as const,
            label: c.name.slice(0, 20),
            data: `action=purchase:pick-supplier&id=${c.id}&name=${encodeURIComponent(c.name)}`,
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
          altText: '確認進貨單',
          template: {
            type: 'confirm',
            text: `供應商：${s.data.partyName}\n${summary}\n小計：$${subtotal.toLocaleString('zh-TW')}\n稅：$${tax.toLocaleString('zh-TW')}\n總計：$${total.toLocaleString('zh-TW')}`.slice(0, 240),
            actions: [
              { type: 'postback', label: '送出', data: 'action=purchase:confirm' },
              { type: 'postback', label: '取消', data: 'action=purchase:cancel' },
            ],
          },
        }],
      });
      return true;
    }

    const parts = text.split(/\s+/);
    const allNumeric = parts.every((p) => Number.isFinite(Number(p.replace(/,/g, ''))));

    // Branch 1: product was pre-selected — "<qty>" or "<qty> <price>".
    if (s.data.pendingProduct && allNumeric && (parts.length === 1 || parts.length === 2)) {
      const quantity = Number(parts[0]);
      const unitPrice = parts.length === 2
        ? Number(parts[1].replace(/,/g, ''))
        : s.data.pendingProduct.costPrice;
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice)) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '數量或單價無法解析，請重新輸入。' }],
        });
        return true;
      }
      const productName = s.data.pendingProduct.name;
      s.data.items.push({ productName, quantity, unitPrice });
      s.data.pendingProduct = undefined;
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `已加入：${productName} × ${quantity} @ $${unitPrice.toLocaleString('zh-TW')}\n目前 ${s.data.items.length} 筆。繼續新增或輸入「完成」確認。`,
        }],
      });
      return true;
    }

    // Branch 2: full-form "<品名> <數量> <單價>".
    if (parts.length >= 3) {
      const unitPrice = Number(parts[parts.length - 1].replace(/,/g, ''));
      const quantity = Number(parts[parts.length - 2]);
      if (Number.isFinite(unitPrice) && Number.isFinite(quantity) && quantity > 0) {
        const productName = parts.slice(0, parts.length - 2).join(' ');
        s.data.items.push({ productName, quantity, unitPrice });
        session.set(tenantId, lineUserId, s);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `已加入：${productName} × ${quantity} @ $${unitPrice.toLocaleString('zh-TW')}\n目前 ${s.data.items.length} 筆。繼續新增或輸入「完成」確認。`,
          }],
        });
        return true;
      }
    }

    // Branch 3: product-name search as a flex carousel with 參考進價 /
    // 上次進價 / 進貨日 from this supplier's history.
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

    const names = products.map((p) => p.name);
    const recent = await prisma.purchaseItem.findMany({
      where: {
        productName: { in: names },
        purchaseOrder: { tenantId, supplierId: s.data.partyId! },
      },
      include: { purchaseOrder: { select: { orderDate: true } } },
    });
    const lastByProduct = new Map<string, { unitPrice: number; date: Date }>();
    for (const it of recent) {
      const d = it.purchaseOrder.orderDate;
      const cur = lastByProduct.get(it.productName);
      if (!cur || d.getTime() > cur.date.getTime()) {
        lastByProduct.set(it.productName, { unitPrice: Number(it.unitPrice), date: d });
      }
    }

    const fmtDate = (d: Date) =>
      `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

    const bubbles = products.slice(0, 10).map((p) => {
      const last = lastByProduct.get(p.name);
      const suggest = last ? last.unitPrice : Number(p.costPrice);
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
            infoRow('參考進價', `$${Number(p.costPrice).toLocaleString('zh-TW')}`),
            infoRow('上次進價', last ? `$${last.unitPrice.toLocaleString('zh-TW')}` : 'null'),
            infoRow('進貨日', last ? fmtDate(last.date) : 'null'),
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
              data: `action=purchase:pick-product&name=${encodeURIComponent(p.name)}&cost=${suggest}`,
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
