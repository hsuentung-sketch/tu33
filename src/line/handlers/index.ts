import type { webhook } from '@line/bot-sdk';

type WebhookEvent = webhook.Event;
type MessageEvent = webhook.MessageEvent;
type PostbackEvent = webhook.PostbackEvent;
type TextMessage = webhook.TextMessageContent;
import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import { getLineClient } from '../client.js';
import { handleQuotationCommand } from './quotation.handler.js';
import { handleSalesCommand } from './sales.handler.js';
import { handlePurchaseCommand } from './purchase.handler.js';
import { handleAccountingCommand } from './accounting.handler.js';
import { handleMasterCommand } from './master.handler.js';

export async function handleEvent(event: WebhookEvent): Promise<void> {
  // Only handle message and postback events
  if (event.type === 'message') {
    await handleMessage(event);
  } else if (event.type === 'postback') {
    await handlePostback(event);
  }
}

async function handleMessage(event: MessageEvent): Promise<void> {
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  // Find employee by LINE userId
  const employee = await prisma.employee.findUnique({
    where: { lineUserId: userId },
    include: { tenant: true },
  });

  if (!employee || !employee.isActive) {
    const client = getLineClient();
    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: '您尚未綁定系統帳號，請聯繫管理員。' }],
    });
    return;
  }

  const client = getLineClient(employee.tenant.lineAccessToken || undefined);
  const tenantId = employee.tenantId;

  if (event.message.type === 'text') {
    const text = (event.message as TextMessage).text.trim();
    await routeTextCommand(text, { event, client, employee, tenantId });
  } else if (event.message.type === 'audio') {
    // Voice message → STT → parse command (AI module)
    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: '語音功能開發中，敬請期待。' }],
    });
  } else if (event.message.type === 'image') {
    // Image → OCR for business card (AI module)
    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: '名片辨識功能開發中，敬請期待。' }],
    });
  }
}

async function handlePostback(event: PostbackEvent): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) return;

  const employee = await prisma.employee.findUnique({
    where: { lineUserId: userId },
    include: { tenant: true },
  });

  if (!employee || !employee.isActive) return;

  const client = getLineClient(employee.tenant.lineAccessToken || undefined);
  const tenantId = employee.tenantId;
  const data = event.postback.data;

  // Parse postback data: action=xxx&param1=yyy&param2=zzz
  const params = new URLSearchParams(data);
  const action = params.get('action') || '';

  const ctx = { event, client, employee, tenantId, params };

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
  }
}

interface CommandContext {
  event: MessageEvent;
  client: ReturnType<typeof getLineClient>;
  employee: Awaited<ReturnType<typeof prisma.employee.findUnique>> & { tenant: unknown };
  tenantId: string;
}

async function routeTextCommand(text: string, ctx: CommandContext): Promise<void> {
  const { event, client } = ctx;

  // Main menu commands
  const commands: Record<string, () => Promise<void>> = {
    '報價': () => handleQuotationCommand('quotation:menu', { ...ctx, event: event as unknown as PostbackEvent, params: new URLSearchParams() }),
    '銷貨': () => handleSalesCommand('sales:menu', { ...ctx, event: event as unknown as PostbackEvent, params: new URLSearchParams() }),
    '進貨': () => handlePurchaseCommand('purchase:menu', { ...ctx, event: event as unknown as PostbackEvent, params: new URLSearchParams() }),
    '帳務': () => handleAccountingCommand('accounting:menu', { ...ctx, event: event as unknown as PostbackEvent, params: new URLSearchParams() }),
    '查詢': () => handleMasterCommand('master:search', { ...ctx, event: event as unknown as PostbackEvent, params: new URLSearchParams(`q=${text.replace('查詢', '').trim()}`) }),
  };

  for (const [keyword, handler] of Object.entries(commands)) {
    if (text.startsWith(keyword)) {
      await handler();
      return;
    }
  }

  // Default: show help
  if (!event.replyToken) return;
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: '請使用選單操作，或輸入以下指令：\n• 報價 - 報價管理\n• 銷貨 - 銷貨管理\n• 進貨 - 進貨管理\n• 帳務 - 帳務查詢\n• 查詢+關鍵字 - 搜尋',
    }],
  });
}
