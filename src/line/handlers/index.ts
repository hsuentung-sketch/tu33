import type { webhook } from '@line/bot-sdk';
import { prisma } from '../../shared/prisma.js';
import { getLineClient } from '../client.js';
import { logger } from '../../shared/logger.js';
import { tryConsumeBindingCode } from '../../modules/core/auth/auth.service.js';
import { handleQuotationCommand } from './quotation.handler.js';
import { handleSalesCommand, handleSalesText } from './sales.handler.js';
import { handlePurchaseCommand, handlePurchaseText } from './purchase.handler.js';
import { handleAccountingCommand, handleAccountingText } from './accounting.handler.js';
import { handleMasterCommand, handleMasterText } from './master.handler.js';
import { handleManagementCommand, handleManagementText } from './management.handler.js';
import { handleVoiceMessage, handleImageMessage } from './media.handler.js';

type WebhookEvent = webhook.Event;
type MessageEvent = webhook.MessageEvent;
type PostbackEvent = webhook.PostbackEvent;
type TextMessage = webhook.TextMessageContent;

export interface HandlerTenant {
  id: string;
  lineAccessToken: string;
}

const BIND_REGEX = /^綁定\s+([A-Z0-9]{6})$/i;

export async function handleEvent(event: WebhookEvent, tenant: HandlerTenant): Promise<void> {
  if (event.type === 'message') {
    await handleMessage(event, tenant);
  } else if (event.type === 'postback') {
    await handlePostback(event, tenant);
  }
}

async function handleMessage(event: MessageEvent, tenant: HandlerTenant): Promise<void> {
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  const client = getLineClient(tenant.lineAccessToken);

  // Binding flow: accept 「綁定 XXXXXX」 even before the user is linked.
  if (event.message.type === 'text') {
    const text = (event.message as TextMessage).text.trim();
    const m = text.match(BIND_REGEX);
    if (m) {
      const code = m[1].toUpperCase();
      const employee = await tryConsumeBindingCode(tenant.id, code, userId);
      await client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: employee
            ? `綁定成功！歡迎 ${employee.name}。`
            : '綁定碼無效或已過期，請聯繫管理員重新產生。',
        }],
      });
      return;
    }
  }

  // Everything else requires a linked employee.
  const employee = await prisma.employee.findFirst({
    where: { tenantId: tenant.id, lineUserId: userId, isActive: true },
  });

  if (!employee) {
    await client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: '您尚未綁定系統帳號。\n請向管理員索取 6 位綁定碼後，輸入「綁定 XXXXXX」。',
      }],
    });
    return;
  }

  const ctx = { event, client, employee, tenantId: tenant.id };

  if (event.message.type === 'text') {
    const text = (event.message as TextMessage).text.trim();
    await routeTextCommand(text, ctx);
  } else if (event.message.type === 'audio') {
    await handleVoiceMessage(event, { ...ctx, accessToken: tenant.lineAccessToken });
  } else if (event.message.type === 'image') {
    await handleImageMessage(event, { ...ctx, accessToken: tenant.lineAccessToken });
  }
}

async function handlePostback(event: PostbackEvent, tenant: HandlerTenant): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) return;

  const employee = await prisma.employee.findFirst({
    where: { tenantId: tenant.id, lineUserId: userId, isActive: true },
  });
  if (!employee) return;

  const client = getLineClient(tenant.lineAccessToken);
  const data = event.postback.data;
  const params = new URLSearchParams(data);
  const action = params.get('action') || '';
  const ctx = { event, client, employee, tenantId: tenant.id, params };

  if (action.startsWith('quotation:')) {
    await handleQuotationCommand(action, ctx);
  } else if (action.startsWith('sales:')) {
    await handleSalesCommand(action, ctx);
  } else if (action.startsWith('purchase:')) {
    await handlePurchaseCommand(action, ctx);
  } else if (action.startsWith('accounting:')) {
    await handleAccountingCommand(action, ctx);
  } else if (action.startsWith('master:')) {
    await handleMasterCommand(action, ctx);
  } else if (action.startsWith('management:')) {
    await handleManagementCommand(action, ctx);
  } else {
    logger.warn('Unknown postback action', { action });
  }
}

interface TextCommandContext {
  event: MessageEvent;
  client: ReturnType<typeof getLineClient>;
  employee: { id: string; name: string; tenantId: string; lineUserId: string | null };
  tenantId: string;
}

async function routeTextCommand(text: string, ctx: TextCommandContext): Promise<void> {
  const { event, client } = ctx;
  const pseudoEvent = event as unknown as PostbackEvent;

  // Consume text for any active multi-step session first.
  if (await handleSalesText(text, ctx)) return;
  if (await handlePurchaseText(text, ctx)) return;
  if (await handleAccountingText(text, ctx)) return;
  if (await handleMasterText(text, ctx)) return;
  if (await handleManagementText(text, ctx)) return;

  if (text.startsWith('報價')) {
    return handleQuotationCommand('quotation:menu', { ...ctx, event: pseudoEvent, params: new URLSearchParams() });
  }
  if (text.startsWith('銷貨')) {
    return handleSalesCommand('sales:menu', { ...ctx, event: pseudoEvent, params: new URLSearchParams() });
  }
  if (text.startsWith('進貨')) {
    return handlePurchaseCommand('purchase:menu', { ...ctx, event: pseudoEvent, params: new URLSearchParams() });
  }
  if (text.startsWith('帳務')) {
    return handleAccountingCommand('accounting:menu', { ...ctx, event: pseudoEvent, params: new URLSearchParams() });
  }
  if (text.startsWith('管理')) {
    return handleManagementCommand('management:menu', { ...ctx, event: pseudoEvent, params: new URLSearchParams() });
  }
  if (text.startsWith('查詢')) {
    const q = text.replace(/^查詢\s*/, '').trim();
    return handleMasterCommand('master:search', {
      ...ctx,
      event: pseudoEvent,
      params: new URLSearchParams(`q=${encodeURIComponent(q)}`),
    });
  }

  if (!event.replyToken) return;
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: '請使用選單操作，或輸入以下指令：\n• 報價 - 報價管理\n• 銷貨 - 銷貨管理\n• 進貨 - 進貨管理\n• 帳務 - 帳務查詢\n• 查詢 關鍵字 - 搜尋',
    }],
  });
}
