import type { webhook } from '@line/bot-sdk';
import { prisma } from '../../shared/prisma.js';
import { getLineClient } from '../client.js';
import { logger } from '../../shared/logger.js';
import { tryConsumeBindingCode, createBindingCode } from '../../modules/core/auth/auth.service.js';
import { writeAudit } from '../../shared/audit.js';
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
      if (employee) {
        void writeAudit({
          tenantId: tenant.id,
          userId: employee.id,
          action: 'LINE_BIND_SUCCESS',
          entity: 'Employee',
          entityId: employee.id,
          detail: { lineUserId: userId },
        });
      }
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
  } else if (event.message.type === 'file') {
    // LINE sends image attachments from the "檔案" picker as type=file
    // instead of type=image. If the mime type looks like an image,
    // route it through the same OCR handler; otherwise, nudge the user.
    const fileMsg = event.message as { fileName?: string };
    const isImageLike = /\.(jpe?g|png|heic|webp|gif)$/i.test(fileMsg.fileName || '');
    if (isImageLike) {
      await handleImageMessage(event, { ...ctx, accessToken: tenant.lineAccessToken });
    } else if (event.replyToken) {
      const client = getLineClient(tenant.lineAccessToken);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '偵測到檔案訊息。若要辨識名片，請改用 LINE「相機」或「相片」發送圖片（不要用「檔案」）。',
        }],
      });
    }
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

  // Admin-only: generate a binding code for an unbound employee.
  //   綁定碼 001       → mint a 10-min one-time code for employee 001
  //   綁定碼 list     → show employees still awaiting binding
  const bindMatch = text.match(/^綁定碼\s+(.+)$/);
  if (bindMatch && event.replyToken) {
    if ((ctx.employee as any).role !== 'ADMIN') {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '⛔ 僅管理員可產生綁定碼。' }],
      });
      return;
    }
    const arg = bindMatch[1].trim();
    if (arg === 'list' || arg === '清單') {
      const list = await prisma.employee.findMany({
        where: { tenantId: ctx.tenantId, isActive: true, lineUserId: null },
        select: { employeeId: true, name: true, role: true },
        orderBy: { employeeId: 'asc' },
      });
      const body = list.length
        ? '尚未綁定 LINE 的員工：\n' + list.map((e) => `• ${e.employeeId} ${e.name}（${e.role}）`).join('\n')
        : '目前沒有尚待綁定的員工。';
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: body + '\n\n輸入「綁定碼 <員工編號>」產生。' }],
      });
      return;
    }
    const target = await prisma.employee.findFirst({
      where: { tenantId: ctx.tenantId, employeeId: arg, isActive: true },
    });
    if (!target) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `找不到員工編號「${arg}」。輸入「綁定碼 list」查看。` }],
      });
      return;
    }
    if (target.lineUserId) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `${target.name} 已綁定 LINE，無需產生綁定碼。` }],
      });
      return;
    }
    try {
      const { code, expiresAt } = await createBindingCode(ctx.tenantId, target.id);
      const mins = Math.round((expiresAt.getTime() - Date.now()) / 60000);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text:
            `✅ 已產生綁定碼\n\n` +
            `員工：${target.name}（${target.employeeId}）\n` +
            `綁定碼：${code}\n` +
            `有效時間：${mins} 分鐘\n\n` +
            `請轉告該員工在 LINE 輸入：\n綁定 ${code}`,
        }],
      });
    } catch (err) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `產生失敗：${(err as Error).message}` }],
      });
    }
    return;
  }

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
