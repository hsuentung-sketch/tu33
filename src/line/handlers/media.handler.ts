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
import type { OcrCard } from '../session.js';
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
          type: 'buttons',
          text: `要將「${(card.companyName ?? card.contactName ?? '此名片').slice(0, 30)}」建立為客戶嗎？`,
          actions: [
            { type: 'postback', label: '✅ 直接建立', data: 'action=master:ocr-create-customer' },
            { type: 'postback', label: '✏️ 編輯後建立', data: 'action=master:ocr-edit-start' },
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
 * 列表，依序問每個欄位的順序。每一步顯示 OCR 值 + 操作提示，
 * 使用者輸入新值，或回 `OK` / `跳過` / `取消`。
 *
 * 進入點：master.handler `master:ocr-edit-start` postback 呼叫 startOcrEditFlow。
 * 文字輸入消費：handleOcrEditText 由 routeTextCommand 串接。
 */
const OCR_EDIT_FIELDS: Array<{
  step: 'ocr-edit-companyName' | 'ocr-edit-contactName' | 'ocr-edit-phone' |
        'ocr-edit-taxId' | 'ocr-edit-email' | 'ocr-edit-address';
  key: 'companyName' | 'contactName' | 'phone' | 'taxId' | 'email' | 'address';
  label: string;
}> = [
  { step: 'ocr-edit-companyName', key: 'companyName', label: '公司名稱' },
  { step: 'ocr-edit-contactName', key: 'contactName', label: '聯絡人' },
  { step: 'ocr-edit-phone',       key: 'phone',       label: '電話' },
  { step: 'ocr-edit-taxId',       key: 'taxId',       label: '統一編號' },
  { step: 'ocr-edit-email',       key: 'email',       label: 'Email' },
  { step: 'ocr-edit-address',     key: 'address',     label: '地址' },
];

function buildEditDraftSummary(draft: OcrCard): string {
  return [
    `公司：${draft.companyName ?? '(空)'}`,
    `聯絡人：${draft.contactName ?? '(空)'}`,
    `電話：${draft.phone ?? '(空)'}`,
    `統編：${draft.taxId ?? '(空)'}`,
    `Email：${draft.email ?? '(空)'}`,
    `地址：${draft.address ?? '(空)'}`,
  ].join('\n');
}

/**
 * 由 master.handler 在使用者按「編輯後建立」時呼叫，初始化逐欄問流程，
 * 第一個 step = ocr-edit-companyName。
 */
export async function startOcrEditFlow(ctx: {
  client: any;
  event: any;
  tenantId: string;
  employee: { id: string; lineUserId: string | null };
}): Promise<void> {
  const s = session.get(ctx.tenantId, ctx.employee.lineUserId!);
  if (!s || !s.data.ocrCard) {
    await ctx.client.replyMessage({
      replyToken: ctx.event.replyToken,
      messages: [{ type: 'text', text: '名片資訊已失效（session 過期），請重新拍照。' }],
    });
    return;
  }
  // 從 ocr:customer flow 切換到 ocr:customer-edit；保留 ocrCard 作為「OCR 原值」，
  // 另存一份 ocrCardDraft 作為使用者編輯中的版本。
  s.flow = 'ocr:customer-edit';
  s.step = OCR_EDIT_FIELDS[0].step;
  s.data.ocrCardDraft = { ...s.data.ocrCard };
  session.set(ctx.tenantId, ctx.employee.lineUserId!, s);

  const first = OCR_EDIT_FIELDS[0];
  const cur = s.data.ocrCard[first.key] ?? '(空)';
  await ctx.client.replyMessage({
    replyToken: ctx.event.replyToken,
    messages: [{
      type: 'text',
      text:
        `📝 逐欄確認名片資訊（共 6 欄）\n\n` +
        `[1/6] ${first.label}\n辨識結果：${cur}\n\n` +
        `回覆方式：\n• 直接輸入新值\n• 回「OK」保留\n• 回「跳過」清空\n• 回「取消」結束`,
    }],
  });
}

/**
 * Text consumer for the逐欄編輯 flow. Returns true if consumed.
 */
export async function handleOcrEditText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return false;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'ocr:customer-edit') return false;
  if (!s.data.ocrCardDraft || !s.data.ocrCard) return false;

  const t = text.trim();
  if (t === '取消' || /^cancel$/i.test(t)) {
    session.clear(tenantId, lineUserId);
    await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '已取消。' }] });
    return true;
  }

  // Find current field
  const idx = OCR_EDIT_FIELDS.findIndex((f) => f.step === s.step);
  if (idx >= 0) {
    const cur = OCR_EDIT_FIELDS[idx];
    const draft = s.data.ocrCardDraft;
    if (t === 'OK' || /^ok$/i.test(t)) {
      // keep ocr value as-is
    } else if (t === '跳過' || /^skip$/i.test(t)) {
      draft[cur.key] = undefined;
    } else {
      draft[cur.key] = t;
    }
    // Next step
    const next = OCR_EDIT_FIELDS[idx + 1];
    if (next) {
      s.step = next.step;
      session.set(tenantId, lineUserId, s);
      const ocrVal = s.data.ocrCard[next.key] ?? '(空)';
      const draftVal = draft[next.key];
      const draftHint = draftVal && draftVal !== s.data.ocrCard[next.key]
        ? `\n目前已改：${draftVal}` : '';
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text:
            `[${idx + 2}/6] ${next.label}\n` +
            `辨識結果：${ocrVal}${draftHint}\n\n` +
            `回「OK」保留 / 輸入新值 / 「跳過」清空 / 「取消」結束`,
        }],
      });
      return true;
    }
    // 所有欄位走完 → 顯示摘要 + 最終確認
    s.step = 'ocr-edit-confirm';
    session.set(tenantId, lineUserId, s);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        { type: 'text', text: `📋 確認以下資料\n\n${buildEditDraftSummary(draft)}` },
        {
          type: 'template',
          altText: '建立客戶',
          template: {
            type: 'confirm',
            text: '送出建立客戶？',
            actions: [
              { type: 'postback', label: '建立', data: 'action=master:ocr-edit-finalize' },
              { type: 'postback', label: '取消', data: 'action=sales:cancel' },
            ],
          },
        },
      ],
    });
    return true;
  }
  return false;
}

/**
 * 完成 ocr:customer-edit 流程後實際建客戶。
 */
export async function finalizeOcrEditCustomer(ctx: {
  tenantId: string;
  employee: { id: string; lineUserId: string | null };
}): Promise<{ id: string; name: string } | null> {
  const s = session.get(ctx.tenantId, ctx.employee.lineUserId!);
  if (!s || s.flow !== 'ocr:customer-edit' || !s.data.ocrCardDraft) return null;
  const card = s.data.ocrCardDraft;
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
        createdByEmployeeId: ctx.employee.id,
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

  // Upsert with createdBy; if the column doesn't exist on this DB
  // (schema drift — prisma db push didn't run on deploy) retry
  // without it so the create still succeeds.
  const baseCreate = {
    tenantId: ctx.tenantId,
    name,
    contactName: card.contactName,
    phone: card.phone,
    email: card.email,
    taxId: card.taxId,
    address: card.address,
  };
  const baseUpdate = {
    contactName: card.contactName ?? undefined,
    phone: card.phone ?? undefined,
    email: card.email ?? undefined,
    taxId: card.taxId ?? undefined,
    address: card.address ?? undefined,
  };
  const created = await runWithAuditContext({ tenantId: ctx.tenantId, userId: ctx.employee.id }, () =>
    prisma.customer.upsert({
      where: { tenantId_name: { tenantId: ctx.tenantId, name } },
      create: { ...baseCreate, createdBy: ctx.employee.id },
      update: baseUpdate,
    }),
  );
  session.clear(ctx.tenantId, ctx.employee.lineUserId!);
  return { id: created.id, name: created.name };
}
