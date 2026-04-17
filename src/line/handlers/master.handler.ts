import { logger } from '../../shared/logger.js';
import { prisma } from '../../shared/prisma.js';
import * as customerService from '../../modules/master/customer/customer.service.js';
import * as supplierService from '../../modules/master/supplier/supplier.service.js';
import * as productService from '../../modules/master/product/product.service.js';
import * as productDocService from '../../modules/master/product/product-document.service.js';
import * as receivableService from '../../modules/accounting/receivable/receivable.service.js';
import * as session from '../session.js';
import { createCustomerFromOcrSession } from './media.handler.js';

const DOC_BUTTON_COLORS: Record<string, string> = {
  PDS: '#1565C0',
  SDS: '#AD1457',
  DM: '#2E7D32',
  OTHER: '#616161',
};
const DOC_LABEL: Record<string, string> = {
  PDS: 'PDS',
  SDS: 'SDS',
  DM: 'DM',
  OTHER: '其他',
};

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
  if (mode === 'product') return replySearchProduct(client, event, tenantId, q, isAll, lineUserId);
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

const PRODUCT_LIST_PAGE_SIZE = 25;

async function replySearchProduct(
  client: any, event: any, tenantId: string, query: string, isAll: boolean,
  lineUserId?: string,
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

  // 「全部」→ 品名列表模式（使用者點選某筆才顯示完整詳情）。
  // 關鍵字搜尋結果 ≤ 20 筆，維持 carousel 顯示完整卡片較直接。
  if (isAll) {
    if (lineUserId) {
      session.set(tenantId, lineUserId, {
        flow: 'master:product-list',
        step: 'party',
        data: { items: [], productListIds: products.map((p) => p.id) },
        updatedAt: Date.now(),
      });
    }
    await sendProductListPage(client, event.replyToken, products, 0);
    return true;
  }

  // 關鍵字搜尋：Flex carousel（原本行為）
  const shown = products.slice(0, 10);
  const docsByProduct = await loadDocsByProduct(tenantId, shown.map((p) => p.id));
  const bubbles = shown.map((p) => buildProductBubble(p, docsByProduct.get(p.id) ?? []));

  const altText = products.length === 1
    ? `產品：${products[0].name}`
    : `產品 ${products.length} 筆（顯示前 ${shown.length} 筆）`;

  const messages: any[] = [];
  if (products.length > shown.length) {
    messages.push({
      type: 'text',
      text: `找到 ${products.length} 筆產品，顯示前 ${shown.length} 筆。若未列出，請輸入更精確的關鍵字。`,
    });
  }
  messages.push({
    type: 'flex',
    altText,
    contents: { type: 'carousel', contents: bubbles },
  });

  await client.replyMessage({ replyToken: event.replyToken, messages });
  return true;
}

/**
 * Send the N-th page of the product list as a single Flex bubble. Each
 * row is a postback button that, when tapped, replies with the full
 * product detail bubble (see `master:product-select`).
 */
async function sendProductListPage(
  client: any,
  replyToken: string,
  products: Array<{ id: string; name: string; code: string }>,
  page: number,
): Promise<void> {
  const total = products.length;
  const totalPages = Math.max(1, Math.ceil(total / PRODUCT_LIST_PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const slice = products.slice(
    clamped * PRODUCT_LIST_PAGE_SIZE,
    (clamped + 1) * PRODUCT_LIST_PAGE_SIZE,
  );

  await client.replyMessage({
    replyToken,
    messages: [{
      type: 'flex',
      altText: `產品清單（共 ${total} 筆）`,
      contents: buildProductListBubble(slice, clamped, totalPages, total),
    }],
  });
}

function buildProductListBubble(
  products: Array<{ id: string; name: string; code: string }>,
  page: number,
  totalPages: number,
  total: number,
) {
  const header = totalPages > 1
    ? `產品清單（共 ${total} 筆，第 ${page + 1}/${totalPages} 頁）`
    : `產品清單（共 ${total} 筆）`;

  const rows = products.map((p) => {
    // LINE button label 上限 40 字，且 bubble 若太長會擠；
    // 優先顯示品名，過長時改用「code · 品名 slice」。
    const fullLabel = p.code ? `${p.code}　${p.name}` : p.name;
    const label = fullLabel.length > 36 ? fullLabel.slice(0, 35) + '…' : fullLabel;
    return {
      type: 'button' as const,
      style: 'link' as const,
      color: '#1565C0',
      height: 'sm' as const,
      action: {
        type: 'postback' as const,
        label,
        data: `action=master:product-select&id=${p.id}`,
        displayText: `查看：${p.name}`,
      },
    };
  });

  const footerBtns: any[] = [];
  if (page > 0) {
    footerBtns.push({
      type: 'button' as const,
      style: 'secondary' as const,
      height: 'sm' as const,
      action: {
        type: 'postback' as const,
        label: '◀ 上一頁',
        data: `action=master:product-list&page=${page - 1}`,
        displayText: `產品清單第 ${page} 頁`,
      },
    });
  }
  if (page < totalPages - 1) {
    footerBtns.push({
      type: 'button' as const,
      style: 'secondary' as const,
      height: 'sm' as const,
      action: {
        type: 'postback' as const,
        label: '下一頁 ▶',
        data: `action=master:product-list&page=${page + 1}`,
        displayText: `產品清單第 ${page + 2} 頁`,
      },
    });
  }

  return {
    type: 'bubble' as const,
    size: 'mega' as const,
    body: {
      type: 'box' as const,
      layout: 'vertical' as const,
      spacing: 'sm' as const,
      contents: [
        { type: 'text', text: header, weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: '點選品名可查看詳情與下載文件', size: 'xs', color: '#888888' },
        { type: 'separator', margin: 'sm' },
        { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'sm', contents: rows },
      ],
    },
    ...(footerBtns.length > 0 ? {
      footer: {
        type: 'box' as const,
        layout: 'horizontal' as const,
        spacing: 'sm' as const,
        contents: footerBtns,
      },
    } : {}),
  };
}

async function loadDocsByProduct(tenantId: string, productIds: string[]) {
  const map = new Map<string, { id: string; type: string; fileName: string }[]>();
  if (productIds.length === 0) return map;
  const docs = await prisma.productDocument.findMany({
    where: { tenantId, productId: { in: productIds } },
    select: { id: true, productId: true, type: true, fileName: true, createdAt: true },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
  });
  // Keep newest-per-type so the bubble shows at most 4 buttons (PDS/SDS/DM/OTHER).
  for (const d of docs) {
    const arr = map.get(d.productId) ?? [];
    if (!arr.find((x) => x.type === d.type)) {
      arr.push({ id: d.id, type: d.type, fileName: d.fileName });
      map.set(d.productId, arr);
    }
  }
  return map;
}

function buildProductBubble(
  p: { id: string; name: string; code: string; category: string | null; salePrice: unknown; note: string | null },
  docs: { id: string; type: string; fileName: string }[],
) {
  const infoLines: any[] = [];
  if (p.code) infoLines.push(kv('編號', p.code));
  if (p.category) infoLines.push(kv('類別', p.category));
  infoLines.push(kv('售價', Number(p.salePrice).toLocaleString()));
  if (p.note) infoLines.push(kv('備註', p.note));

  const docButtons = docs.length > 0
    ? docs.map((d) => ({
        type: 'button' as const,
        style: 'primary' as const,
        color: DOC_BUTTON_COLORS[d.type] ?? '#616161',
        height: 'sm' as const,
        action: {
          type: 'postback' as const,
          label: `下載 ${DOC_LABEL[d.type] ?? d.type}`,
          data: `action=master:product-doc&id=${d.id}`,
          displayText: `下載 ${DOC_LABEL[d.type] ?? d.type}：${p.name}`,
        },
      }))
    : [{
        type: 'text' as const,
        text: '（無可下載文件）',
        size: 'xs' as const,
        color: '#9e9e9e',
        align: 'center' as const,
      }];

  return {
    type: 'bubble' as const,
    size: 'kilo' as const,
    body: {
      type: 'box' as const,
      layout: 'vertical' as const,
      spacing: 'sm' as const,
      contents: [
        { type: 'text', text: p.name, weight: 'bold', size: 'md', wrap: true },
        { type: 'separator' as const, margin: 'sm' as const },
        { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'sm', contents: infoLines },
        { type: 'separator' as const, margin: 'sm' as const },
        { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'sm', contents: docButtons },
      ],
    },
  };
}

function kv(k: string, v: string) {
  return {
    type: 'box' as const,
    layout: 'baseline' as const,
    spacing: 'sm' as const,
    contents: [
      { type: 'text' as const, text: k, color: '#9e9e9e', size: 'sm' as const, flex: 2 },
      { type: 'text' as const, text: v, size: 'sm' as const, wrap: true, flex: 5 },
    ],
  };
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

    case 'master:product-doc': {
      const docId = params.get('id') || '';
      if (!docId) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '下載連結參數缺失。' }],
        });
        return;
      }
      try {
        const { shortUrl, fileName, type } = await productDocService.buildShortDownloadUrl(
          tenantId,
          docId,
          employee.id,
        );
        const label = DOC_LABEL[type] ?? type;
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `📄 ${label}：${fileName}\n${shortUrl}\n\n（連結 7 天內有效）`,
          }],
        });
      } catch (err) {
        logger.error('product-doc download failed', err as Error);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `下載失敗：${(err as Error).message}` }],
        });
      }
      return;
    }

    case 'master:product-select': {
      // Tap a row from the "all products" list → show full detail bubble.
      const productId = params.get('id') || '';
      if (!productId) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '產品連結參數缺失。' }],
        });
        return;
      }
      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId },
      });
      if (!product) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '找不到該產品（可能已停用）。' }],
        });
        return;
      }
      const docsMap = await loadDocsByProduct(tenantId, [productId]);
      const bubble = buildProductBubble(product, docsMap.get(productId) ?? []);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'flex', altText: `產品：${product.name}`, contents: bubble }],
      });
      return;
    }

    case 'master:product-list': {
      // Pagination for the "all products" list.
      const page = Math.max(0, parseInt(params.get('page') || '0', 10));
      const lineUserId = employee.lineUserId;
      const s = lineUserId ? session.get(tenantId, lineUserId) : undefined;
      const cachedIds = s?.flow === 'master:product-list' ? s.data.productListIds : undefined;
      if (!cachedIds || cachedIds.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: '產品清單已過期，請重新點「查詢 → 產品」並輸入「全部」。',
          }],
        });
        return;
      }
      // Re-fetch the products referenced by the cached ID list so we get
      // fresh name/price without re-querying the whole table.
      const rows = await prisma.product.findMany({
        where: { tenantId, id: { in: cachedIds }, isActive: true },
        select: { id: true, name: true, code: true },
      });
      // Preserve the original order captured at list time.
      const byId = new Map(rows.map((p) => [p.id, p]));
      const products = cachedIds
        .map((id) => byId.get(id))
        .filter(Boolean) as Array<{ id: string; name: string; code: string }>;
      // Refresh session TTL for continued browsing.
      if (lineUserId) {
        session.set(tenantId, lineUserId, {
          flow: 'master:product-list',
          step: 'party',
          data: { items: [], productListIds: cachedIds },
          updatedAt: Date.now(),
        });
      }
      await sendProductListPage(client, event.replyToken, products, page);
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
