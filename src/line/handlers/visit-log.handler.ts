/**
 * 工作日誌 LINE handler。
 *
 * 流程 (visitlog:create)：
 *   visitlog-date    使用者輸入日期（YYYY-MM-DD 或「今天」「昨天」）
 *   visitlog-customer 模糊搜尋客戶 → Flex carousel 選一張
 *   visitlog-content 自由文字輸入拜訪內容
 *   visitlog-next    下次行動日（YYYY-MM-DD 或「無」）
 *   visitlog-confirm 顯示摘要 + 確認按鈕 → POST /api/visit-logs 等價直接呼叫 service
 *
 * Entry：
 *   - 文字「日誌」「工作日誌」 → handleVisitLogCommand('visitlog:start', ctx)
 *   - postback action=visitlog:menu / visitlog:start / visitlog:pick-customer / visitlog:confirm / visitlog:cancel
 */
import { logger } from '../../shared/logger.js';
import * as session from '../session.js';
import { fuzzySearch } from '../../shared/search.js';
import * as visitLogService from '../../modules/master/visit-log/visit-log.service.js';
import { runWithAuditContext } from '../../shared/audit.js';

function parseDateInput(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (t === '今天' || /^today$/i.test(t)) return new Date().toISOString().slice(0, 10);
  if (t === '昨天' || /^yesterday$/i.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  // YYYY-MM-DD / YYYY/MM/DD
  const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function customerCarousel(hits: { id: string; name: string }[]): any {
  return {
    type: 'flex',
    altText: '選擇客戶',
    contents: {
      type: 'carousel',
      contents: hits.slice(0, 10).map((c) => ({
        type: 'bubble',
        size: 'micro',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: c.name, wrap: true, weight: 'bold', size: 'sm' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'button',
            style: 'primary',
            color: '#00BFA5',
            height: 'sm',
            action: {
              type: 'postback',
              label: '選擇',
              data: `action=visitlog:pick-customer&id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.name)}`,
            },
          }],
        },
      })),
    },
  };
}

export async function handleVisitLogCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return;

  switch (action) {
    case 'visitlog:menu':
    case 'visitlog:start': {
      const s = session.start(tenantId, lineUserId, 'visitlog:create');
      s.step = 'visitlog-date';
      s.data.visitDraft = {};
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '📝 新增工作日誌\n\n請輸入拜訪日期（YYYY-MM-DD），\n或輸入「今天」「昨天」。',
        }],
      });
      return;
    }

    case 'visitlog:pick-customer': {
      const customerId = params.get('id');
      const customerName = params.get('name');
      if (!customerId || !customerName) return;
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'visitlog:create') return;
      s.data.visitDraft = { ...(s.data.visitDraft ?? {}), customerId, customerName };
      s.step = 'visitlog-content';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `客戶：${customerName}\n\n請輸入拜訪內容（自由文字）。`,
        }],
      });
      return;
    }

    case 'visitlog:confirm': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'visitlog:create' || !s.data.visitDraft) return;
      const d = s.data.visitDraft;
      if (!d.visitDate || !d.customerId || !d.content) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '資料不完整，請重新輸入。' }],
        });
        session.clear(tenantId, lineUserId);
        return;
      }
      try {
        const log = await runWithAuditContext(
          { tenantId, userId: employee.id },
          () => visitLogService.create(tenantId, {
            visitDate: new Date(d.visitDate!),
            customerId: d.customerId!,
            content: d.content!,
            nextActionDate: d.nextActionDate ? new Date(d.nextActionDate) : null,
            createdByEmployeeId: employee.id,
          }),
        );
        session.clear(tenantId, lineUserId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text:
              `✅ 工作日誌已建立\n\n` +
              `日期：${d.visitDate}\n` +
              `客戶：${d.customerName}\n` +
              `${d.nextActionDate ? `下次行動：${d.nextActionDate}\n` : ''}` +
              `編號：${log.id.slice(0, 8)}…`,
          }],
        });
      } catch (err) {
        logger.error('visitlog create failed', { error: (err as Error).message });
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `建立失敗：${(err as Error).message}` }],
        });
      }
      return;
    }

    case 'visitlog:cancel': {
      session.clear(tenantId, lineUserId);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消。' }],
      });
      return;
    }

    default:
      logger.warn('Unknown visitlog action', { action });
  }
}

/**
 * Text consumer for the visitlog multi-step flow.
 * Returns true if the text was consumed.
 */
export async function handleVisitLogText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return false;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'visitlog:create') return false;

  if (s.step === 'visitlog-date') {
    const iso = parseDateInput(text);
    if (!iso) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '日期格式錯誤，請用 2026-05-12，或輸入「今天」「昨天」。' }],
      });
      return true;
    }
    s.data.visitDraft = { ...(s.data.visitDraft ?? {}), visitDate: iso };
    s.step = 'visitlog-customer';
    session.set(tenantId, lineUserId, s);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '請輸入客戶關鍵字以搜尋。' }],
    });
    return true;
  }

  if (s.step === 'visitlog-customer') {
    const hits = await fuzzySearch(tenantId, text, { types: ['customer'] });
    const customers = hits.filter((h) => h.type === 'customer').slice(0, 10);
    if (customers.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `找不到客戶「${text}」，請換個關鍵字。` }],
      });
      return true;
    }
    if (customers.length === 1) {
      const c = customers[0];
      s.data.visitDraft = {
        ...(s.data.visitDraft ?? {}),
        customerId: c.id,
        customerName: c.name,
      };
      s.step = 'visitlog-content';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `客戶：${c.name}\n\n請輸入拜訪內容（自由文字）。`,
        }],
      });
      return true;
    }
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [customerCarousel(customers.map((c) => ({ id: c.id, name: c.name })))],
    });
    return true;
  }

  if (s.step === 'visitlog-content') {
    const content = text.trim();
    if (content.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '拜訪內容不可空白，請重新輸入。' }],
      });
      return true;
    }
    s.data.visitDraft = { ...(s.data.visitDraft ?? {}), content };
    s.step = 'visitlog-next';
    session.set(tenantId, lineUserId, s);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: '若有下次行動日請輸入（YYYY-MM-DD），\n沒有請輸入「無」或「跳過」。',
      }],
    });
    return true;
  }

  if (s.step === 'visitlog-next') {
    const t = text.trim();
    let nextActionDate: string | null = null;
    if (t !== '無' && t !== '跳過' && !/^(no|skip)$/i.test(t)) {
      const iso = parseDateInput(t);
      if (!iso) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '日期格式錯誤，請用 2026-05-12，或輸入「無」。' }],
        });
        return true;
      }
      nextActionDate = iso;
    }
    s.data.visitDraft = { ...(s.data.visitDraft ?? {}), nextActionDate };
    s.step = 'visitlog-confirm';
    session.set(tenantId, lineUserId, s);
    const d = s.data.visitDraft!;
    const preview =
      `📋 確認工作日誌\n\n` +
      `日期：${d.visitDate}\n` +
      `客戶：${d.customerName}\n` +
      `內容：${(d.content ?? '').slice(0, 200)}\n` +
      `下次行動：${d.nextActionDate ?? '（無）'}`;
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        { type: 'text', text: preview },
        {
          type: 'template',
          altText: '確認建立工作日誌',
          template: {
            type: 'confirm',
            text: '送出建立？',
            actions: [
              { type: 'postback', label: '送出', data: 'action=visitlog:confirm' },
              { type: 'postback', label: '取消', data: 'action=visitlog:cancel' },
            ],
          },
        },
      ],
    });
    return true;
  }

  return false;
}
