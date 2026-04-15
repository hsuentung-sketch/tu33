import type { webhook } from '@line/bot-sdk';
import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import { runWithAuditContext } from '../../shared/audit.js';
import { downloadLineContent } from '../content.js';
import { transcribeAudio } from '../../ai/whisper.js';
import { parseVoiceCommand, type ParsedVoiceCommand } from '../../ai/voice-parser.js';
import { recognizeBusinessCard } from '../../ai/ocr.js';
import { fuzzySearch } from '../../shared/search.js';
import * as session from '../session.js';
import * as salesOrderService from '../../modules/sales/sales-order/sales-order.service.js';
import * as purchaseOrderService from '../../modules/purchase/purchase-order/purchase-order.service.js';

type MessageEvent = webhook.MessageEvent;

interface MediaCtx {
  event: MessageEvent;
  client: any;
  tenantId: string;
  employee: { id: string; name: string; lineUserId: string | null };
  accessToken: string;
}

/**
 * Handle LINE voice message: download → transcribe → parse intent → execute or confirm.
 */
export async function handleVoiceMessage(event: MessageEvent, ctx: MediaCtx): Promise<void> {
  const { client, tenantId, employee, accessToken } = ctx;
  const replyToken = event.replyToken;
  if (!replyToken) return;

  try {
    const messageId = (event.message as { id: string }).id;
    const buffer = await downloadLineContent(messageId, accessToken);
    const transcript = await transcribeAudio(buffer, { language: 'zh' });
    logger.info('Voice transcript', { transcript });

    const parsed = await parseVoiceCommand(transcript);
    await executeVoiceCommand(parsed, ctx);
  } catch (err) {
    logger.error('Voice handling failed', { error: err });
    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `語音處理失敗：${(err as Error).message}` }],
    });
  }

  void tenantId; void employee;
}

async function executeVoiceCommand(parsed: ParsedVoiceCommand, ctx: MediaCtx): Promise<void> {
  const { client, event, tenantId, employee } = ctx;
  const replyToken = event.replyToken!;

  if (parsed.intent === 'query_customer' && parsed.query) {
    const hits = (await fuzzySearch(tenantId, parsed.query, { types: ['customer'] })).slice(0, 5);
    const text = hits.length
      ? `📋 客戶搜尋：${parsed.query}\n` + hits.map((h, i) => `${i + 1}. ${h.name}`).join('\n')
      : `找不到客戶：${parsed.query}`;
    await client.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
    return;
  }

  if (parsed.intent === 'query_product' && parsed.query) {
    const hits = (await fuzzySearch(tenantId, parsed.query, { types: ['product'] })).slice(0, 5);
    const text = hits.length
      ? `📦 產品搜尋：${parsed.query}\n` + hits.map((h, i) => `${i + 1}. ${h.name}`).join('\n')
      : `找不到產品：${parsed.query}`;
    await client.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
    return;
  }

  if ((parsed.intent === 'create_sales_order' || parsed.intent === 'create_purchase_order') && parsed.items?.length) {
    const isPurchase = parsed.intent === 'create_purchase_order';
    const partyName = isPurchase ? parsed.supplierName : parsed.customerName;
    if (!partyName) {
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: isPurchase ? '請指定供應商。' : '請指定客戶。' }],
      });
      return;
    }
    const partyType = isPurchase ? 'supplier' : 'customer';
    const hits = (await fuzzySearch(tenantId, partyName, { types: [partyType] })).filter(
      (r) => r.type === partyType,
    );
    if (hits.length === 0) {
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: `找不到${isPurchase ? '供應商' : '客戶'}：${partyName}` }],
      });
      return;
    }
    const party = hits[0];
    const items = parsed.items.map((it) => ({
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice ?? 0,
    }));

    // Missing prices → start a session so user can fill them in.
    if (items.some((it) => !it.unitPrice || it.quantity <= 0)) {
      const s = session.start(tenantId, employee.lineUserId!, isPurchase ? 'purchase:create' : 'sales:create');
      s.data.partyId = party.id;
      s.data.partyName = party.name;
      s.step = 'items';
      s.data.items = items.filter((it) => it.unitPrice && it.quantity > 0);
      session.set(tenantId, employee.lineUserId!, s);
      await client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `已辨識：${party.name}\n部分品項缺單價/數量，請補齊：\n<品名> <數量> <單價>\n完成後輸入「完成」。`,
        }],
      });
      return;
    }

    try {
      const order = isPurchase
        ? await runWithAuditContext({ tenantId, userId: employee.id }, () =>
            purchaseOrderService.create(tenantId, {
              supplierId: party.id,
              internalStaff: employee.name,
              createdBy: employee.id,
              items,
            }),
          )
        : await runWithAuditContext({ tenantId, userId: employee.id }, () =>
            salesOrderService.create(tenantId, {
              customerId: party.id,
              salesPerson: employee.name,
              createdBy: employee.id,
              items,
            }),
          );
      await client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ 語音開單成功\n單號：${order.orderNo}\n對象：${party.name}\n總計：$${Number(order.totalAmount).toLocaleString('zh-TW')}`,
        }],
      });
    } catch (err) {
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: `開單失敗：${(err as Error).message}` }],
      });
    }
    return;
  }

  await client.replyMessage({
    replyToken,
    messages: [{
      type: 'text',
      text: `無法辨識意圖：${parsed.raw}\n\n請試試：「幫我開一張銷貨單給毅金，EK-C-215 兩桶單價一萬七千二」`,
    }],
  });
}

/**
 * Handle LINE image message as business card OCR.
 * Extracts fields, shows confirm template → creates customer on postback.
 */
export async function handleImageMessage(event: MessageEvent, ctx: MediaCtx): Promise<void> {
  const { client, tenantId, employee, accessToken } = ctx;
  const replyToken = event.replyToken;
  if (!replyToken) return;

  // Helper: try reply first; if that fails (expired token / already used),
  // fall back to pushMessage so the user still sees the result.
  const safeSend = async (messages: any[]) => {
    try {
      await client.replyMessage({ replyToken, messages });
    } catch (replyErr) {
      logger.warn('replyMessage failed, falling back to push', {
        error: (replyErr as Error).message,
      });
      if (employee.lineUserId) {
        try {
          await client.pushMessage({ to: employee.lineUserId, messages });
        } catch (pushErr) {
          logger.error('pushMessage also failed', { error: (pushErr as Error).message });
        }
      }
    }
  };

  logger.info('OCR: image received', {
    tenantId,
    lineUserId: employee.lineUserId,
    messageId: (event.message as { id?: string }).id,
  });

  try {
    const messageId = (event.message as { id: string }).id;
    logger.info('OCR: downloading image from LINE');
    const buffer = await downloadLineContent(messageId, accessToken);
    logger.info('OCR: image downloaded', { bytes: buffer.length });

    logger.info('OCR: calling Google Vision');
    const card = await recognizeBusinessCard(buffer);
    logger.info('OCR: recognition done', {
      hasCompany: !!card.companyName,
      hasContact: !!card.contactName,
      hasPhone: !!card.phone,
      rawTextLen: card.rawText?.length ?? 0,
    });

    if (!card.companyName && !card.contactName && !card.phone) {
      await safeSend([{
        type: 'text',
        text: `名片辨識沒抓到公司/聯絡人/電話。\n原始文字前 200 字：\n${(card.rawText || '(空)').slice(0, 200)}`,
      }]);
      return;
    }

    // Stash in session so the confirm postback can read it.
    const s = session.start(tenantId, employee.lineUserId!, 'ocr:customer');
    s.data.ocrCard = {
      companyName: card.companyName,
      contactName: card.contactName,
      phone: card.phone,
      email: card.email,
      address: card.address,
      taxId: card.taxId,
    };
    session.set(tenantId, employee.lineUserId!, s);

    const summary =
      `辨識結果：\n` +
      `公司：${card.companyName ?? '-'}\n` +
      `聯絡人：${card.contactName ?? '-'}\n` +
      `電話：${card.phone ?? '-'}\n` +
      `Email：${card.email ?? '-'}\n` +
      `統編：${card.taxId ?? '-'}\n` +
      `地址：${card.address ?? '-'}`;

    await safeSend([
      { type: 'text', text: summary },
      {
        type: 'template',
        altText: '建立客戶',
        template: {
          type: 'confirm',
          text: `要將「${card.companyName ?? card.contactName ?? '此名片'}」建立為客戶嗎？`,
          actions: [
            { type: 'postback', label: '建立', data: 'action=master:ocr-create-customer' },
            { type: 'postback', label: '取消', data: 'action=sales:cancel' },
          ],
        },
      },
    ]);
  } catch (err) {
    logger.error('OCR handling failed', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    await safeSend([{
      type: 'text',
      text: `名片辨識失敗：${(err as Error).message}`,
    }]);
    return;
  }

}

/**
 * Called from master.handler when user confirms creating a customer from OCR.
 */
export async function createCustomerFromOcrSession(ctx: {
  tenantId: string;
  employee: { id: string; lineUserId: string | null };
}): Promise<{ id: string; name: string } | null> {
  const s = session.get(ctx.tenantId, ctx.employee.lineUserId!);
  if (!s || !s.data.ocrCard) return null;
  const card = s.data.ocrCard;
  const name = (card.companyName ?? card.contactName ?? '').trim();
  if (!name) return null;

  const created = await runWithAuditContext({ tenantId: ctx.tenantId, userId: ctx.employee.id }, () =>
    prisma.customer.upsert({
      where: { tenantId_name: { tenantId: ctx.tenantId, name } },
      create: {
        tenantId: ctx.tenantId,
        name,
        contactName: card.contactName,
        phone: card.phone,
        email: card.email,
        taxId: card.taxId,
        address: card.address,
        createdBy: ctx.employee.id,
      },
      update: {
        contactName: card.contactName ?? undefined,
        phone: card.phone ?? undefined,
        email: card.email ?? undefined,
        taxId: card.taxId ?? undefined,
        address: card.address ?? undefined,
      },
    }),
  );
  session.clear(ctx.tenantId, ctx.employee.lineUserId!);
  return { id: created.id, name: created.name };
}
