import * as session from '../session.js';
import { prisma } from '../../shared/prisma.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/logger.js';
import * as machineRecordService from '../../modules/master/machine-record/machine-record.service.js';
import { makeSafeSend } from '../safe-send.js';
import { downloadLineContent } from '../content.js';

async function ocrExtractSerial(imageBuffer: Buffer): Promise<string | null> {
  if (!config.google.visionApiKey) return null;

  try {
    const base64Image = imageBuffer.toString('base64');
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${config.google.visionApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64Image },
            features: [{ type: 'TEXT_DETECTION' }],
          }],
        }),
      },
    );
    const json = await response.json() as any;
    const text = json.responses?.[0]?.textAnnotations?.[0]?.description ?? '';
    const match = text.match(/[A-Z0-9]{6,20}/g);
    return match ? match[0] : text.trim().split('\n')[0] || null;
  } catch (err) {
    logger.error('OCR serial extraction failed', err);
    return null;
  }
}

export async function handleMachineRegisterCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;
  const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'machine-register' });

  switch (action) {
    case 'machine:confirm-serial': {
      const serial = params.get('serial');
      const productId = params.get('productId');
      if (!serial || !productId) return;

      const lineUserId = employee.lineUserId as string;
      session.set(tenantId, lineUserId, {
        flow: 'machine:register',
        step: 'machine-warranty-start',
        data: {
          items: [],
          machineSerial: serial,
          machineProductId: productId,
        },
        updatedAt: Date.now(),
      });

      await safeSend([{
        type: 'text',
        text: `序號確認：${serial}\n\n請輸入保固開始日期（格式：2026/06/14）\n或輸入「今天」使用今日日期。`,
      }]);
      break;
    }
  }
}

/**
 * Handle text commands for machine registration flow.
 * - 「登記序號」→ start flow, ask for product
 * - 「機器序號 <serial>」→ query warranty info
 */
export async function handleMachineRegisterText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId as string;
  const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'machine-register' });

  const s = session.get(tenantId, lineUserId);

  // Active registration session
  if (s?.flow === 'machine:register') {
    switch (s.step) {
      case 'machine-select-product': {
        const products = await prisma.product.findMany({
          where: {
            tenantId,
            isActive: true,
            OR: [
              { name: { contains: text, mode: 'insensitive' } },
              { code: { contains: text, mode: 'insensitive' } },
            ],
          },
          take: 5,
        });
        if (products.length === 0) {
          await safeSend([{ type: 'text', text: `找不到產品「${text}」，請重新輸入產品名稱或編號。` }]);
          return true;
        }
        const product = products[0];
        s.data.machineProductId = product.id;
        s.data.machineProductName = product.name;
        s.step = 'machine-enter-serial';
        session.set(tenantId, lineUserId, s);
        await safeSend([{
          type: 'text',
          text: `已選擇：${product.name}\n\n請輸入機台序號（英數字 6-20 碼）。`,
        }]);
        return true;
      }

      case 'machine-enter-serial': {
        const serial = text.trim().toUpperCase();
        if (serial.length < 3) {
          await safeSend([{ type: 'text', text: '序號太短，請重新輸入。' }]);
          return true;
        }
        const existing = await machineRecordService.getBySerial(tenantId, serial);
        if (existing) {
          await safeSend([{ type: 'text', text: `序號「${serial}」已登記（產品：${existing.product.name}）。請輸入其他序號。` }]);
          return true;
        }
        s.data.machineSerial = serial;
        s.step = 'machine-warranty-start';
        session.set(tenantId, lineUserId, s);
        await safeSend([{
          type: 'text',
          text: `序號：${serial}\n\n請輸入保固開始日期（格式：2026/06/14）\n或輸入「今天」使用今日日期。`,
        }]);
        return true;
      }

      case 'machine-warranty-start': {
        let startDate: Date;
        if (text === '今天' || text === '今日') {
          startDate = new Date();
        } else {
          const parsed = Date.parse(text.replace(/\//g, '-'));
          if (isNaN(parsed)) {
            await safeSend([{ type: 'text', text: '日期格式不對，請用 2026/06/14 格式。' }]);
            return true;
          }
          startDate = new Date(parsed);
        }
        s.data.machineWarrantyStart = startDate.toISOString();
        s.step = 'machine-warranty-months';
        session.set(tenantId, lineUserId, s);
        await safeSend([{
          type: 'text',
          text: `保固開始：${startDate.toLocaleDateString('zh-TW')}\n\n請輸入保固月數（預設 12，直接按 Enter 或輸入數字）。`,
        }]);
        return true;
      }

      case 'machine-warranty-months': {
        const months = text.trim() === '' ? 12 : Number(text);
        if (!Number.isFinite(months) || months < 1) {
          await safeSend([{ type: 'text', text: '請輸入有效的月數（如 12、24）。' }]);
          return true;
        }
        const startDate = new Date(s.data.machineWarrantyStart!);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + months);

        session.clear(tenantId, lineUserId);
        try {
          const record = await machineRecordService.create(tenantId, {
            productId: s.data.machineProductId!,
            serialNumber: s.data.machineSerial!,
            warrantyStartAt: startDate,
            warrantyEndAt: endDate,
            registeredBy: employee.id,
          });
          await safeSend([{
            type: 'text',
            text: `序號登記完成！\n產品：${record.product.name}\n序號：${record.serialNumber}\n保固：${startDate.toLocaleDateString('zh-TW')} ~ ${endDate.toLocaleDateString('zh-TW')}`,
          }]);
        } catch (err) {
          await safeSend([{ type: 'text', text: `登記失敗：${(err as Error).message}` }]);
        }
        return true;
      }
    }
    return false;
  }

  // 「登記序號」→ start registration
  if (text === '登記序號') {
    session.set(tenantId, lineUserId, {
      flow: 'machine:register',
      step: 'machine-select-product',
      data: { items: [] },
      updatedAt: Date.now(),
    });
    await safeSend([{
      type: 'text',
      text: '開始登記機台序號。\n\n請輸入產品名稱或編號（如：割草機 CG411）。',
    }]);
    return true;
  }

  // 「機器序號 <serial>」→ query warranty
  const queryMatch = text.match(/^機器序號\s+(.+)$/);
  if (queryMatch) {
    const serial = queryMatch[1].trim().toUpperCase();
    const record = await machineRecordService.getBySerial(tenantId, serial);
    if (!record) {
      await safeSend([{ type: 'text', text: `找不到序號「${serial}」的登記記錄。` }]);
      return true;
    }
    const now = new Date();
    const isExpired = record.warrantyEndAt <= now;
    const daysLeft = Math.ceil((record.warrantyEndAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const status = isExpired ? '已過期' : daysLeft <= 30 ? `即將到期（${daysLeft} 天）` : `有效（剩 ${daysLeft} 天）`;

    await safeSend([{
      type: 'text',
      text: `機台序號查詢\n序號：${record.serialNumber}\n產品：${record.product.name}\n保固：${record.warrantyStartAt.toLocaleDateString('zh-TW')} ~ ${record.warrantyEndAt.toLocaleDateString('zh-TW')}\n狀態：${status}`,
    }]);
    return true;
  }

  return false;
}

/**
 * Handle image message for serial OCR during machine registration.
 * Called from handlers/index.ts when user is in machine:register flow
 * and step is machine-enter-serial.
 */
export async function handleMachineRegisterImage(
  event: any,
  ctx: { tenantId: string; employee: any; client: any; accessToken: string },
): Promise<boolean> {
  const { tenantId, employee, client, accessToken } = ctx;
  const lineUserId = employee.lineUserId as string;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'machine:register' || s.step !== 'machine-enter-serial') return false;

  const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'machine-register' });

  if (!config.google.visionApiKey) {
    await safeSend([{ type: 'text', text: 'OCR 未啟用，請直接輸入序號。' }]);
    return true;
  }

  try {
    const imageBuffer = await downloadLineContent(event.message.id, accessToken);

    const serial = await ocrExtractSerial(imageBuffer);
    if (!serial) {
      await safeSend([{ type: 'text', text: '無法辨識序號，請直接輸入序號。' }]);
      return true;
    }

    const existing = await machineRecordService.getBySerial(tenantId, serial);
    if (existing) {
      await safeSend([{ type: 'text', text: `辨識到序號「${serial}」，但此序號已登記（產品：${existing.product.name}）。請輸入其他序號。` }]);
      return true;
    }

    s.data.machineSerial = serial;
    s.step = 'machine-warranty-start';
    session.set(tenantId, lineUserId, s);
    await safeSend([{
      type: 'text',
      text: `OCR 辨識序號：${serial}\n\n請輸入保固開始日期（格式：2026/06/14）\n或輸入「今天」使用今日日期。\n\n序號不對？直接輸入正確序號即可。`,
    }]);
  } catch (err) {
    logger.error('Machine OCR failed', err);
    await safeSend([{ type: 'text', text: '圖片辨識失敗，請直接輸入序號。' }]);
  }
  return true;
}
