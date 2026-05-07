/**
 * 快速建立傳票（LINE chat）— 對接後端 v2.7.2 的快速費用登記。
 *
 * 入口：「帳務」menu → 「➕ 新增傳票」按鈕（僅 ADMIN / ACCOUNTING 可見）
 *
 * 兩條路徑：
 *  📸 拍照辨識：使用者傳發票照片 → Google Vision OCR + regex 抽欄位 →
 *               帶入 description / amount / date → 進確認流程
 *  ✍️ 手動輸入：逐步問 description → amount → paymentMethod → 確認
 *
 * 後端：POST /api/accounting/expense/quick（透過內部呼叫 expenseService.quickExpense）
 *  - 用途說明會自動推論費用科目（v2.7.2 關鍵字規則）
 *  - 使用者可在確認前說「修改用途 XXX」覆蓋
 *  - 預設 status='pending'；ADMIN 可在確認時選「直接過帳」
 */
import type { webhook } from '@line/bot-sdk';
import { logger } from '../../shared/logger.js';
import { runWithAuditContext } from '../../shared/audit.js';
import { downloadLineContent } from '../content.js';
import { recognizeInvoice } from '../../ai/invoice-ocr.js';
import * as session from '../session.js';
import * as expenseService from '../../modules/accounting/expense/expense.service.js';

type MessageEvent = webhook.MessageEvent;

interface JeCtx {
  event: any;
  client: any;
  tenantId: string;
  employee: { id: string; name: string; lineUserId: string | null; role?: string };
  params?: URLSearchParams;
  /** 給 handleJeImage 用，從 image dispatcher 帶進來 */
  accessToken?: string;
}

const ALLOWED_ROLES = new Set(['ADMIN', 'ACCOUNTING']);

function canUseJe(role?: string): boolean {
  return !!role && ALLOWED_ROLES.has(role);
}

function isAdmin(role?: string): boolean {
  return role === 'ADMIN';
}

function todayIso(): string {
  // 業務日 = Asia/Taipei
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

// ----- safeSend：reply 失敗 fallback push（共用） -----
function makeSafeSend(client: any, replyToken: string | undefined, lineUserId: string | null) {
  return async (messages: any[]) => {
    if (replyToken) {
      try {
        await client.replyMessage({ replyToken, messages });
        return;
      } catch (err) {
        logger.warn('je replyMessage failed, falling back to push', {
          error: (err as Error).message,
        });
      }
    }
    if (lineUserId) {
      try {
        await client.pushMessage({ to: lineUserId, messages });
      } catch (err) {
        logger.error('je pushMessage also failed', { error: (err as Error).message });
      }
    }
  };
}

// ----- 進入點：accounting:menu 內的「新增傳票」按鈕 -----
export async function handleJeCommand(action: string, ctx: JeCtx): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;
  const lineUserId = employee.lineUserId!;
  const safeSend = makeSafeSend(client, event.replyToken, lineUserId);

  if (!canUseJe(employee.role)) {
    await safeSend([{ type: 'text', text: '⛔ 僅 ADMIN / 會計可使用「新增傳票」。' }]);
    return;
  }

  switch (action) {
    case 'je:start': {
      const s = session.start(tenantId, lineUserId, 'je:create');
      s.step = 'je-method';
      s.data.jeDraft = { invoiceDate: todayIso() };
      session.set(tenantId, lineUserId, s);
      await safeSend([{
        type: 'template',
        altText: '新增傳票',
        template: {
          type: 'buttons',
          title: '新增傳票',
          text: '請選擇登錄方式',
          actions: [
            { type: 'postback', label: '📸 拍照辨識發票', data: 'action=je:method-ocr' },
            { type: 'postback', label: '✍️ 手動輸入', data: 'action=je:method-manual' },
            { type: 'postback', label: '❌ 取消', data: 'action=je:cancel' },
          ],
        },
      }]);
      return;
    }

    case 'je:method-ocr': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'je:create') return;
      if (!process.env.GOOGLE_VISION_API_KEY) {
        // 無 OCR 設定 → 自動 fallback 手動
        s.step = 'je-describe';
        session.set(tenantId, lineUserId, s);
        await safeSend([{
          type: 'text',
          text: '⚠️ OCR 未設定（缺 GOOGLE_VISION_API_KEY），改用手動輸入。\n\n請描述用途（如「搭計程車到客戶端」）：',
        }]);
        return;
      }
      s.step = 'je-ocr-wait-image';
      session.set(tenantId, lineUserId, s);
      await safeSend([{
        type: 'text',
        text:
          '📷 請傳送發票或收據圖片（限 30 分鐘內）\n\n' +
          '⚠️ 提升辨識率小撇步：\n' +
          '• LINE 「相機」拍照會壓縮畫質 → 建議改用「+」→「檔案」picker 上傳原圖\n' +
          '• 或從手機相簿選照片直接傳\n' +
          '• 若辨識仍不佳，請改用後台網頁「會計→傳票→📷 拍照辨識上傳」（不壓縮畫質）',
      }]);
      return;
    }

    case 'je:method-manual': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'je:create') return;
      s.step = 'je-describe';
      session.set(tenantId, lineUserId, s);
      await safeSend([{
        type: 'text',
        text: '✍️ 請描述用途（如「搭計程車到客戶端」、「繳電費」、「文具採購」）：',
      }]);
      return;
    }

    case 'je:pay-cash':
    case 'je:pay-bank':
    case 'je:pay-payable': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'je:create' || s.step !== 'je-payment') return;
      s.data.jeDraft!.paymentMethod = action === 'je:pay-cash' ? 'cash'
        : action === 'je:pay-bank' ? 'bank' : 'payable';
      s.step = 'je-confirm';
      session.set(tenantId, lineUserId, s);
      await sendConfirmCard(safeSend, s.data.jeDraft!, employee.role);
      return;
    }

    case 'je:status-pending':
    case 'je:status-posted': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'je:create' || s.step !== 'je-confirm') return;
      // ACCOUNTING 強制 pending；只 ADMIN 可選 posted
      if (action === 'je:status-posted' && !isAdmin(employee.role)) {
        await safeSend([{ type: 'text', text: '⛔ 僅 ADMIN 可選擇「直接過帳」。' }]);
        return;
      }
      s.data.jeDraft!.status = action === 'je:status-posted' ? 'posted' : 'pending';
      session.set(tenantId, lineUserId, s);
      await sendConfirmCard(safeSend, s.data.jeDraft!, employee.role);
      return;
    }

    case 'je:submit': {
      const s = session.get(tenantId, lineUserId);
      if (!s || s.flow !== 'je:create' || s.step !== 'je-confirm') return;
      const draft = s.data.jeDraft!;
      try {
        const result = await runWithAuditContext({ tenantId, userId: employee.id }, () =>
          expenseService.quickExpense(tenantId, employee.id, {
            date: new Date(draft.invoiceDate || todayIso()),
            description: draft.description!,
            amount: draft.amount!,
            paymentMethod: draft.paymentMethod!,
            voucherNo: draft.voucherNo,
            status: draft.status === 'posted' && isAdmin(employee.role) ? 'posted' : 'pending',
          }),
        );
        session.clear(tenantId, lineUserId);
        const inf = result.inferred;
        const lines = [
          `✅ 已建立傳票 ${result.entry.entryNo}`,
          `用途：${draft.description}`,
          `金額：$${draft.amount?.toLocaleString('zh-TW')}`,
          `科目：${inf.expenseCode} ${inf.expenseName}`,
          `付款：${inf.paymentCode} ${inf.paymentName}`,
          `狀態：${draft.status === 'posted' ? '已過帳' : '待審核'}`,
        ];
        params; void params;
        await safeSend([{ type: 'text', text: lines.join('\n') }]);
      } catch (err) {
        const msg = (err as Error).message || '建立失敗';
        await safeSend([{ type: 'text', text: `❌ 建立傳票失敗：${msg}` }]);
      }
      return;
    }

    case 'je:cancel': {
      session.clear(tenantId, lineUserId);
      await safeSend([{ type: 'text', text: '已取消新增傳票。' }]);
      return;
    }

    default:
      logger.warn(`Unknown je action: ${action}`);
  }
}

// ----- 文字處理：在 je-describe / je-amount / je-confirm 階段消費文字 -----
export async function handleJeText(text: string, ctx: JeCtx): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId!;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'je:create') return false;
  const safeSend = makeSafeSend(client, event.replyToken, lineUserId);

  if (text === '取消' || text === '/cancel') {
    session.clear(tenantId, lineUserId);
    await safeSend([{ type: 'text', text: '已取消新增傳票。' }]);
    return true;
  }

  // 「修改用途 XXX」可在確認前隨時改 description（觸發重新推論科目）
  const m = text.match(/^修改用途\s+(.+)$/);
  if (m && (s.step === 'je-confirm' || s.step === 'je-payment')) {
    s.data.jeDraft!.description = m[1].trim();
    session.set(tenantId, lineUserId, s);
    if (s.step === 'je-confirm') {
      await sendConfirmCard(safeSend, s.data.jeDraft!, employee.role);
    } else {
      await safeSend([{ type: 'text', text: `用途已更新為「${m[1].trim()}」。請繼續選付款方式。` }]);
    }
    return true;
  }

  if (s.step === 'je-describe') {
    const desc = text.trim();
    if (desc.length < 1) {
      await safeSend([{ type: 'text', text: '用途說明不可為空，請重新輸入。' }]);
      return true;
    }
    s.data.jeDraft!.description = desc;
    s.step = 'je-amount';
    session.set(tenantId, lineUserId, s);
    // 推論一次給使用者預覽
    let preview = '';
    try {
      const inferred = await expenseService.previewExpenseAccount(tenantId, desc);
      preview = inferred.matchedKeyword
        ? `（已判斷會計科目：${inferred.code} ${inferred.name}，命中：${inferred.matchedKeyword}）\n`
        : `（無命中關鍵字，將歸入 ${inferred.code} ${inferred.name}）\n`;
    } catch { /* 模組未啟用時忽略 */ }
    await safeSend([{
      type: 'text',
      text: `${preview}請輸入金額（純數字，如 1200）：`,
    }]);
    return true;
  }

  if (s.step === 'je-amount') {
    const n = Number(text.replace(/[,\s$]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      await safeSend([{ type: 'text', text: '金額需為正整數，請重新輸入（如 1200）：' }]);
      return true;
    }
    s.data.jeDraft!.amount = Math.round(n);
    s.step = 'je-payment';
    session.set(tenantId, lineUserId, s);
    await sendPaymentSelector(safeSend);
    return true;
  }

  // 其他步驟未處理 → 不消費文字（讓使用者看到主控提示）
  return false;
}

// ----- 圖片處理：je-ocr-wait-image 階段收照片 -----
export async function handleJeImage(event: MessageEvent, ctx: {
  tenantId: string;
  employee: { id: string; lineUserId: string | null; role?: string };
  client: any;
  accessToken: string;
}): Promise<boolean> {
  const { client, tenantId, employee, accessToken } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return false;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'je:create' || s.step !== 'je-ocr-wait-image') return false;

  const safeSend = makeSafeSend(client, event.replyToken, lineUserId);

  try {
    const messageId = (event.message as { id: string }).id;
    const buffer = await downloadLineContent(messageId, accessToken);
    const inv = await recognizeInvoice(buffer);
    logger.info('je OCR done', {
      hasMerchant: !!inv.merchantName,
      hasAmount: !!inv.amount,
      hasDate: !!inv.invoiceDate,
    });

    const draft = s.data.jeDraft!;
    draft.ocr = {
      merchantName: inv.merchantName,
      invoiceNo: inv.invoiceNo,
      rawText: inv.rawText?.slice(0, 400),
    };
    if (inv.merchantName) draft.description = inv.merchantName;
    if (inv.amount && inv.amount > 0) draft.amount = inv.amount;
    if (inv.invoiceDate) draft.invoiceDate = inv.invoiceDate.toISOString().slice(0, 10);
    if (inv.invoiceNo) draft.voucherNo = inv.invoiceNo;

    // 缺哪一項就停在哪一步
    if (!draft.description) {
      s.step = 'je-describe';
      session.set(tenantId, lineUserId, s);
      await safeSend([{ type: 'text', text: '辨識結果中沒抓到商家名稱，請手動輸入用途說明：' }]);
      return true;
    }
    if (!draft.amount) {
      s.step = 'je-amount';
      session.set(tenantId, lineUserId, s);
      await safeSend([{
        type: 'text',
        text: `辨識：${draft.description}\n📷 沒抓到金額，請手動輸入金額（純數字）：`,
      }]);
      return true;
    }

    s.step = 'je-payment';
    session.set(tenantId, lineUserId, s);
    let preview = '';
    try {
      const inferred = await expenseService.previewExpenseAccount(tenantId, draft.description);
      preview = `判斷會計科目：${inferred.code} ${inferred.name}` +
        (inferred.matchedKeyword ? `（命中：${inferred.matchedKeyword}）` : '（無命中→雜項）') + '\n';
    } catch { /* ignore */ }
    await safeSend([
      {
        type: 'text',
        text:
          `📷 已辨識：\n` +
          `商家：${draft.description}\n` +
          `金額：$${draft.amount.toLocaleString('zh-TW')}\n` +
          `日期：${draft.invoiceDate}\n` +
          (draft.voucherNo ? `發票號：${draft.voucherNo}\n` : '') +
          preview +
          `\n如要修改用途，輸入「修改用途 XXX」`,
      },
    ]);
    await sendPaymentSelector(safeSend);
    return true;
  } catch (err) {
    logger.error('je OCR failed', { error: (err as Error).message });
    // 失敗 fallback 手動
    s.step = 'je-describe';
    session.set(tenantId, lineUserId, s);
    await safeSend([{
      type: 'text',
      text:
        `📷 OCR 失敗：${(err as Error).message}\n\n` +
        '改用手動輸入。請描述用途：\n' +
        '（如照片畫質不佳，建議改用後台「會計→傳票→📷 拍照辨識上傳」）',
    }]);
    return true;
  }
}

// ----- 共用 UI -----
async function sendPaymentSelector(safeSend: (msgs: any[]) => Promise<void>): Promise<void> {
  await safeSend([{
    type: 'template',
    altText: '付款方式',
    template: {
      type: 'buttons',
      title: '付款方式',
      text: '請選擇付款帳戶',
      actions: [
        { type: 'postback', label: '💵 現金 (1101)', data: 'action=je:pay-cash' },
        { type: 'postback', label: '🏦 銀行存款 (1111)', data: 'action=je:pay-bank' },
        { type: 'postback', label: '📋 應付帳款 (賒帳)', data: 'action=je:pay-payable' },
        { type: 'postback', label: '❌ 取消', data: 'action=je:cancel' },
      ],
    },
  }]);
}

async function sendConfirmCard(
  safeSend: (msgs: any[]) => Promise<void>,
  draft: import('../session.js').JeDraft,
  role?: string,
): Promise<void> {
  const payLabel = draft.paymentMethod === 'cash' ? '現金 (1101)'
    : draft.paymentMethod === 'bank' ? '銀行存款 (1111)' : '應付帳款 (2101)';
  const status = draft.status ?? 'pending';
  const statusLabel = status === 'posted' ? '直接過帳' : '待審核';

  // 文字摘要 + buttons
  const summary =
    `📋 確認登錄\n` +
    `日期：${draft.invoiceDate}\n` +
    `用途：${draft.description}\n` +
    `金額：$${draft.amount?.toLocaleString('zh-TW')}\n` +
    `付款：${payLabel}\n` +
    (draft.voucherNo ? `憑證號：${draft.voucherNo}\n` : '') +
    `狀態：${statusLabel}\n\n` +
    `如要改用途，輸入「修改用途 XXX」`;

  const actions: any[] = [
    { type: 'postback', label: '✅ 建立傳票', data: 'action=je:submit' },
  ];
  // ADMIN 可切「直接過帳 / 待審核」
  if (isAdmin(role)) {
    if (status === 'pending') {
      actions.push({ type: 'postback', label: '⚡ 改為直接過帳', data: 'action=je:status-posted' });
    } else {
      actions.push({ type: 'postback', label: '⏳ 改為待審核', data: 'action=je:status-pending' });
    }
  }
  actions.push({ type: 'postback', label: '❌ 取消', data: 'action=je:cancel' });

  await safeSend([
    { type: 'text', text: summary },
    {
      type: 'template',
      altText: '確認傳票',
      template: { type: 'buttons', title: '確認', text: '確認後送出', actions },
    },
  ]);
}
