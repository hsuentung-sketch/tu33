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

/**
 * 客戶選擇 carousel；postbackAction 決定點下後走「新增」或「查詢」分支。
 */
function buildCustomerCarousel(
  hits: { id: string; name: string }[],
  postbackAction: 'visitlog:pick-customer' | 'visitlog:pick-search-customer',
  buttonColor: string,
): any {
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
            color: buttonColor,
            height: 'sm',
            action: {
              type: 'postback',
              label: '選擇',
              data: `action=${postbackAction}&id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.name)}`,
            },
          }],
        },
      })),
    },
  };
}

function customerCarousel(hits: { id: string; name: string }[]): any {
  return buildCustomerCarousel(hits, 'visitlog:pick-customer', '#00BFA5');
}

function searchCustomerCarousel(hits: { id: string; name: string }[]): any {
  return buildCustomerCarousel(hits, 'visitlog:pick-search-customer', '#1565C0');
}

function btn(label: string, data: string, color: string): any {
  return {
    type: 'button',
    style: 'primary',
    color,
    height: 'sm',
    action: { type: 'postback', label, data },
  };
}

export async function handleVisitLogCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return;

  switch (action) {
    case 'visitlog:menu': {
      // 顯示「新增 / 查詢」子選單
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: '工作日誌',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'md',
              contents: [
                { type: 'text', text: '工作日誌', weight: 'bold', size: 'lg' },
                { type: 'separator' },
                btn('📝 新增日誌', 'action=visitlog:start', '#00897B'),
                btn('🔍 查詢日誌', 'action=visitlog:search', '#1565C0'),
              ],
            },
          },
        }],
      });
      return;
    }

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

    case 'visitlog:search': {
      const s = session.start(tenantId, lineUserId, 'visitlog:search');
      s.step = 'visitlog-search-customer';
      session.set(tenantId, lineUserId, s);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '🔍 查詢工作日誌\n\n請輸入要查詢的公司關鍵字。',
        }],
      });
      return;
    }

    case 'visitlog:pick-search-customer': {
      const customerId = params.get('id');
      const customerName = params.get('name');
      if (!customerId || !customerName) return;
      await replyVisitLogList(ctx, customerId, customerName);
      session.clear(tenantId, lineUserId);
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
 * 取出該客戶最近 10 筆 visit log 並以純文字回覆。
 * SALES 角色自動過濾自己建的；ADMIN/ACCOUNTING/VIEWER 看全租戶。
 */
async function replyVisitLogList(ctx: any, customerId: string, customerName: string): Promise<void> {
  const { client, event, tenantId, employee } = ctx;
  const isSales = employee?.role === 'SALES';
  try {
    const logs = await visitLogService.list(tenantId, {
      customerId,
      employeeId: isSales ? employee.id : undefined,
      limit: 10,
    });
    if (logs.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `「${customerName}」沒有任何工作日誌${isSales ? '（由您建立）' : ''}。` }],
      });
      return;
    }
    const lines = logs.map((l, i) => {
      const d = new Date(l.visitDate).toISOString().slice(0, 10);
      const next = l.nextActionDate
        ? `\n  下次：${new Date(l.nextActionDate).toISOString().slice(0, 10)}`
        : '';
      const author = (l as any).createdByEmployee?.name
        ? ` (${(l as any).createdByEmployee.name})`
        : '';
      const content = (l.content || '').length > 100
        ? l.content.slice(0, 100) + '…'
        : (l.content || '');
      return `${i + 1}. [${d}]${author}\n  ${content}${next}`;
    });
    const head = `📋 ${customerName}\n最近 ${logs.length} 筆工作日誌${isSales ? '（由您建立）' : ''}\n\n`;
    // LINE text 上限 5000 字；10 筆 *200 字 = 2000 安全範圍
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: head + lines.join('\n\n') }],
    });
  } catch (err) {
    logger.error('visitlog search failed', { error: (err as Error).message });
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `查詢失敗：${(err as Error).message}` }],
    });
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
  if (!s) return false;

  // 查詢流程：visitlog:search → 輸入公司關鍵字
  if (s.flow === 'visitlog:search' && s.step === 'visitlog-search-customer') {
    const hits = await fuzzySearch(tenantId, text, { types: ['customer'] });
    const customers = hits.filter((h) => h.type === 'customer').slice(0, 10);
    if (customers.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `找不到客戶「${text}」，請換個關鍵字（回「取消」結束）。` }],
      });
      return true;
    }
    if (customers.length === 1) {
      const c = customers[0];
      await replyVisitLogList(ctx, c.id, c.name);
      session.clear(tenantId, lineUserId);
      return true;
    }
    // 多筆 → carousel 讓使用者選；使用者選後走 visitlog:pick-search-customer postback
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [searchCustomerCarousel(customers.map((c) => ({ id: c.id, name: c.name })))],
    });
    return true;
  }

  if (s.flow !== 'visitlog:create') return false;

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
