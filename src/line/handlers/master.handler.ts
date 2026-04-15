import { logger } from '../../shared/logger.js';
import * as customerService from '../../modules/master/customer/customer.service.js';
import * as supplierService from '../../modules/master/supplier/supplier.service.js';
import * as productService from '../../modules/master/product/product.service.js';
import * as receivableService from '../../modules/accounting/receivable/receivable.service.js';
import * as session from '../session.js';
import { createCustomerFromOcrSession } from './media.handler.js';

const ALL_KEYWORDS = new Set(['全部', 'all', 'ALL', '*']);

/**
 * Consume a bare text message when the user has an active 查詢 session
 * (kicked off by tapping the Rich Menu 查詢 button and picking a
 * sub-type). Returns true if the message was consumed.
 */
export async function handleMasterText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return false;
  const s = session.get(tenantId, lineUserId);
  if (!s || s.flow !== 'master:search') return false;

  const mode = s.data.searchMode;
  session.clear(tenantId, lineUserId);
  const q = text.trim();
  const isAll = ALL_KEYWORDS.has(q) || q === '';

  if (mode === 'customer') return replySearchCustomer(client, event, tenantId, q, isAll);
  if (mode === 'product') return replySearchProduct(client, event, tenantId, q, isAll);
  if (mode === 'ar') return replySearchAr(client, event, tenantId, q, isAll);

  // No mode set (legacy empty-q path) — fall through to combined search.
  await replyCombined(client, event, tenantId, q);
  return true;
}

// ---------- Handlers ----------

async function replySearchCustomer(
  client: any, event: any, tenantId: string, query: string, isAll: boolean,
): Promise<boolean> {
  const customers = isAll
    ? await customerService.list(tenantId)
    : await customerService.findByName(tenantId, query);

  if (!customers.length) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: isAll ? '目前沒有客戶資料。' : `找不到「${query}」相關客戶。` }],
    });
    return true;
  }
  const lines = customers.slice(0, 30).map((c, i) => {
    const bits = [`${i + 1}. ${c.name}`];
    if (c.contactName) bits.push(`   聯絡人：${c.contactName}`);
    if (c.taxId) bits.push(`   統一編號：${c.taxId}`);
    if (c.phone) bits.push(`   電話：${c.phone}`);
    const addr = [c.zipCode, c.address].filter(Boolean).join(' ');
    if (addr) bits.push(`   地址：${addr}`);
    if (c.email) bits.push(`   Email：${c.email}`);
    if (c.paymentDays != null) bits.push(`   付款天數：${c.paymentDays}`);
    if (c.grade) bits.push(`   等級：${c.grade}`);
    return bits.join('\n');
  }).join('\n\n');
  const header = `【客戶清單 ${customers.length}】${customers.length > 30 ? '（僅顯示前 30 筆）' : ''}`;
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `${header}\n\n${truncate(lines)}` }],
  });
  return true;
}

async function replySearchProduct(
  client: any, event: any, tenantId: string, query: string, isAll: boolean,
): Promise<boolean> {
  const products = isAll
    ? await productService.list(tenantId)
    : await productService.findByNameOrCode(tenantId, query);

  if (!products.length) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: isAll ? '目前沒有產品資料。' : `找不到「${query}」相關產品。` }],
    });
    return true;
  }
  const lines = products.slice(0, 30).map((p, i) => {
    const bits = [`${i + 1}. ${p.name}`];
    if (p.code) bits.push(`   編號：${p.code}`);
    if (p.category) bits.push(`   類別：${p.category}`);
    bits.push(`   售價：${Number(p.salePrice).toLocaleString()}`);
    bits.push(`   進價：${Number(p.costPrice).toLocaleString()}`);
    if (p.note) bits.push(`   備註：${p.note}`);
    return bits.join('\n');
  }).join('\n\n');
  const header = `【產品清單 ${products.length}】${products.length > 30 ? '（僅顯示前 30 筆）' : ''}`;
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `${header}\n\n${truncate(lines)}` }],
  });
  return true;
}

async function replySearchAr(
  client: any, event: any, tenantId: string, query: string, isAll: boolean,
): Promise<boolean> {
  // If a customer keyword was given, narrow to matching customers first.
  let customerFilter: string[] | null = null;
  if (!isAll) {
    const matches = await customerService.findByName(tenantId, query);
    if (!matches.length) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `找不到「${query}」相關客戶，無法篩選應收帳款。` }],
      });
      return true;
    }
    customerFilter = matches.map((c) => c.id);
  }

  const allAr = await receivableService.list(tenantId);
  const rows = customerFilter
    ? allAr.filter((r) => customerFilter!.includes(r.customerId))
    : allAr;

  if (!rows.length) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: isAll ? '目前沒有應收帳款資料。' : `「${query}」目前沒有應收帳款。` }],
    });
    return true;
  }

  const lines = rows.slice(0, 30).map((r, i) => {
    const due = r.dueDate instanceof Date ? r.dueDate : new Date(r.dueDate);
    const dueStr = `${due.getFullYear()}/${String(due.getMonth() + 1).padStart(2, '0')}/${String(due.getDate()).padStart(2, '0')}`;
    const status = r.overdueStatus?.message ?? (r.isPaid ? '已入帳' : '待付款');
    const bits = [
      `${i + 1}. ${r.customer?.name ?? '(客戶)'}`,
      `   ${r.billingYear}/${String(r.billingMonth).padStart(2, '0')} 請款`,
      `   金額：${Number(r.amount).toLocaleString()}`,
      `   到期日：${dueStr}`,
      `   狀態：${status}`,
    ];
    if (r.invoiceNo) bits.push(`   發票：${r.invoiceNo}`);
    if (r.salesOrder?.orderNo) bits.push(`   銷貨單：${r.salesOrder.orderNo}`);
    return bits.join('\n');
  }).join('\n\n');
  const header = `【應收帳款 ${rows.length}】${rows.length > 30 ? '（僅顯示前 30 筆）' : ''}`;
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `${header}\n\n${truncate(lines)}` }],
  });
  return true;
}

// Legacy combined search (when text "查詢 xxx" comes in directly).
async function replyCombined(client: any, event: any, tenantId: string, query: string): Promise<void> {
  if (!query) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '請輸入搜尋關鍵字，例如：查詢 毅金' }],
    });
    return;
  }
  const [customers, suppliers, products] = await Promise.all([
    customerService.findByName(tenantId, query),
    supplierService.findByName(tenantId, query),
    productService.findByNameOrCode(tenantId, query),
  ]);
  if (!customers.length && !suppliers.length && !products.length) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `找不到「${query}」相關資料。` }],
    });
    return;
  }
  const blocks: string[] = [];
  if (customers.length) blocks.push(`【客戶 ${customers.length}】\n` + customers.map((c, i) => `${i + 1}. ${c.name}${c.contactName ? `（${c.contactName}）` : ''}${c.phone ? ` ${c.phone}` : ''}`).join('\n'));
  if (suppliers.length) blocks.push(`【供應商 ${suppliers.length}】\n` + suppliers.map((s, i) => `${i + 1}. ${s.name}${s.contactName ? `（${s.contactName}）` : ''}${s.phone ? ` ${s.phone}` : ''}`).join('\n'));
  if (products.length) blocks.push(`【產品 ${products.length}】\n` + products.map((p, i) => `${i + 1}. ${p.name} 售價 ${Number(p.salePrice).toLocaleString()}`).join('\n'));
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: truncate(blocks.join('\n\n')) }],
  });
}

function truncate(s: string): string {
  if (s.length <= 4800) return s;
  return s.slice(0, 4800) + '\n…（結果過長，請輸入更精確關鍵字）';
}

// ---------- Menu / postback ----------

function searchMenuFlex() {
  const btn = (label: string, data: string, color: string) => ({
    type: 'button' as const,
    style: 'primary' as const,
    color,
    action: { type: 'postback' as const, data, label, displayText: label },
  });
  return {
    type: 'bubble' as const,
    body: {
      type: 'box' as const,
      layout: 'vertical' as const,
      spacing: 'md',
      contents: [
        { type: 'text', text: '查詢選單', weight: 'bold', size: 'lg' },
        { type: 'text', text: '請選擇要查詢的類型', size: 'sm', color: '#666666' },
        { type: 'separator' },
        btn('1. 查詢客戶資料',      'action=master:search:customer', '#2E7D32'),
        btn('2. 查詢產品資料與價格', 'action=master:search:product',  '#1565C0'),
        btn('3. 查詢應收帳款',      'action=master:search:ar',       '#AD1457'),
      ],
    },
  };
}

function startSearchSession(tenantId: string, lineUserId: string, mode: 'customer' | 'product' | 'ar'): void {
  session.set(tenantId, lineUserId, {
    flow: 'master:search',
    step: 'party',
    data: { items: [], searchMode: mode },
    updatedAt: Date.now(),
  });
}

export async function handleMasterCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, params, employee } = ctx;

  switch (action) {
    case 'master:ocr-create-customer': {
      const created = await createCustomerFromOcrSession({ tenantId, employee });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: created ? `✅ 已建立客戶：${created.name}` : '名片資訊已失效，請重新拍攝。',
        }],
      });
      return;
    }

    case 'master:search': {
      const query = (params.get('q') || '').trim();
      if (!query) {
        // Rich Menu 查詢 tap → show the 3-item submenu.
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'flex', altText: '查詢選單', contents: searchMenuFlex() }],
        });
        return;
      }
      // "查詢 xxx" text path — combined search across all types.
      await replyCombined(client, event, tenantId, query);
      return;
    }

    case 'master:search:customer': {
      if (employee.lineUserId) startSearchSession(tenantId, employee.lineUserId, 'customer');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '請輸入客戶簡稱（或輸入「全部」列出所有客戶）：' }],
      });
      return;
    }
    case 'master:search:product': {
      if (employee.lineUserId) startSearchSession(tenantId, employee.lineUserId, 'product');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '請輸入產品簡稱或編號（或輸入「全部」列出所有產品）：' }],
      });
      return;
    }
    case 'master:search:ar': {
      if (employee.lineUserId) startSearchSession(tenantId, employee.lineUserId, 'ar');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '請輸入客戶簡稱（或輸入「全部」列出所有應收帳款）：' }],
      });
      return;
    }

    default:
      logger.warn(`Unknown master action: ${action}`);
  }
}
