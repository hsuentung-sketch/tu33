import { logger } from '../../shared/logger.js';
import * as customerService from '../../modules/master/customer/customer.service.js';
import * as supplierService from '../../modules/master/supplier/supplier.service.js';
import { prisma } from '../../shared/prisma.js';
import * as session from '../session.js';

type Role = 'ADMIN' | 'SALES' | 'PURCHASING' | 'ACCOUNTING' | 'VIEWER';

function isAdmin(employee: { role?: string }): boolean {
  return employee.role === 'ADMIN';
}

function canCreateCustomer(employee: { role?: string }): boolean {
  return employee.role === 'ADMIN' || employee.role === 'SALES';
}

async function denyNonAdmin(client: any, event: any): Promise<void> {
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: '⛔ 此操作需要管理員 (ADMIN) 權限。' }],
  });
}

// ---------- Session helpers for multi-step add flows ----------

type CreateFlow = 'mgmt:emp:add' | 'mgmt:sup:add';

function startCreate(tenantId: string, lineUserId: string, flow: CreateFlow): void {
  session.set(tenantId, lineUserId, {
    flow: flow as any,
    step: 'party',
    data: { items: [], pendingCreate: { stage: 'name', draft: {} } } as any,
    updatedAt: Date.now(),
  });
}

/**
 * Text handler for the multi-step add flows. Returns true if consumed.
 */
export async function handleManagementText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId;
  if (!lineUserId) return false;

  // One-shot customer create via "新增客戶 name / contact / phone / email / tax / address"
  const m = text.match(/^新增客戶\s+(.+)$/);
  if (m) {
    if (!canCreateCustomer(employee)) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '⛔ 僅業務或管理員可新增客戶。' }],
      });
      return true;
    }
    const parts = m[1].split('/').map((p) => p.trim());
    const [name, contactName, phone, email, taxId, address] = parts;
    if (!name) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '格式：新增客戶 <公司名> / <聯絡人> / <電話> / <Email> / <統編> / <地址>' }],
      });
      return true;
    }
    try {
      const c = await customerService.create(tenantId, {
        name,
        contactName: contactName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        taxId: taxId || undefined,
        address: address || undefined,
        createdBy: employee.id,
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 已新增客戶：${c.name}` }],
      });
    } catch (err) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `新增失敗：${(err as Error).message}` }],
      });
    }
    return true;
  }

  const s = session.get(tenantId, lineUserId);
  if (!s) return false;
  const flow = s.flow as string;
  if (flow !== 'mgmt:emp:add' && flow !== 'mgmt:sup:add') return false;

  const pc = (s.data as any).pendingCreate as { stage: string; draft: Record<string, any> };
  const input = text.trim();
  const skip = input === '-' || input === '略過' || input === '跳過';

  if (flow === 'mgmt:emp:add') {
    return stepEmployee(client, event, tenantId, lineUserId, pc, input, skip);
  } else {
    return stepSupplier(client, event, tenantId, lineUserId, pc, input, skip);
  }
}

async function stepEmployee(
  client: any, event: any, tenantId: string, lineUserId: string,
  pc: { stage: string; draft: any }, input: string, skip: boolean,
): Promise<boolean> {
  switch (pc.stage) {
    case 'name':
      if (!input) return replyPrompt(client, event, '請輸入員工姓名：');
      pc.draft.name = input;
      pc.stage = 'employeeId';
      return replyPrompt(client, event, `姓名：${input}\n請輸入員工編號（如 001）：`);
    case 'employeeId':
      if (!input) return replyPrompt(client, event, '請輸入員工編號：');
      pc.draft.employeeId = input;
      pc.stage = 'role';
      return replyPrompt(client, event,
        '請選擇權限角色（輸入代號）：\n' +
        '1. ADMIN（管理員）\n' +
        '2. SALES（業務）\n' +
        '3. PURCHASING（採購）\n' +
        '4. ACCOUNTING（會計）\n' +
        '5. VIEWER（唯讀）',
      );
    case 'role': {
      const roleMap: Record<string, Role> = {
        '1': 'ADMIN', 'ADMIN': 'ADMIN', 'admin': 'ADMIN', '管理員': 'ADMIN',
        '2': 'SALES', 'SALES': 'SALES', 'sales': 'SALES', '業務': 'SALES',
        '3': 'PURCHASING', 'PURCHASING': 'PURCHASING', '採購': 'PURCHASING',
        '4': 'ACCOUNTING', 'ACCOUNTING': 'ACCOUNTING', '會計': 'ACCOUNTING',
        '5': 'VIEWER', 'VIEWER': 'VIEWER', '唯讀': 'VIEWER',
      };
      const role = roleMap[input];
      if (!role) return replyPrompt(client, event, '無效的角色代號，請輸入 1-5。');
      pc.draft.role = role;
      pc.stage = 'phone';
      return replyPrompt(client, event, `權限：${role}\n請輸入電話（或輸入「略過」）：`);
    }
    case 'phone':
      if (!skip) pc.draft.phone = input;
      pc.stage = 'email';
      return replyPrompt(client, event, '請輸入 Email（或輸入「略過」）：');
    case 'email': {
      if (!skip) pc.draft.email = input;
      try {
        await prisma.employee.create({
          data: {
            tenantId,
            name: pc.draft.name,
            employeeId: pc.draft.employeeId,
            role: pc.draft.role,
            phone: pc.draft.phone,
            email: pc.draft.email,
          },
        });
        session.clear(tenantId, lineUserId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 已新增員工：${pc.draft.name}（${pc.draft.employeeId}）權限 ${pc.draft.role}\n請記得產生綁定碼讓該員工綁定 LINE。` }],
        });
      } catch (err) {
        session.clear(tenantId, lineUserId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `新增失敗：${(err as Error).message}` }],
        });
      }
      return true;
    }
  }
  return false;
}

async function stepSupplier(
  client: any, event: any, tenantId: string, lineUserId: string,
  pc: { stage: string; draft: any }, input: string, skip: boolean,
): Promise<boolean> {
  switch (pc.stage) {
    case 'name':
      if (!input) return replyPrompt(client, event, '請輸入供應商名稱：');
      pc.draft.name = input;
      pc.stage = 'contactName';
      return replyPrompt(client, event, `名稱：${input}\n請輸入聯絡人（或輸入「略過」）：`);
    case 'contactName':
      if (!skip) pc.draft.contactName = input;
      pc.stage = 'phone';
      return replyPrompt(client, event, '請輸入電話（或輸入「略過」）：');
    case 'phone':
      if (!skip) pc.draft.phone = input;
      pc.stage = 'taxId';
      return replyPrompt(client, event, '請輸入統一編號（或輸入「略過」）：');
    case 'taxId':
      if (!skip) pc.draft.taxId = input;
      pc.stage = 'email';
      return replyPrompt(client, event, '請輸入 Email（或輸入「略過」）：');
    case 'email':
      if (!skip) pc.draft.email = input;
      pc.stage = 'address';
      return replyPrompt(client, event, '請輸入地址（或輸入「略過」）：');
    case 'address':
      if (!skip) pc.draft.address = input;
      pc.stage = 'paymentDays';
      return replyPrompt(client, event, '請輸入付款天數（數字，預設 60）：');
    case 'paymentDays': {
      const n = Number(input);
      const paymentDays = skip || !Number.isFinite(n) ? 60 : n;
      try {
        await supplierService.create(tenantId, {
          name: pc.draft.name,
          contactName: pc.draft.contactName,
          phone: pc.draft.phone,
          taxId: pc.draft.taxId,
          email: pc.draft.email,
          address: pc.draft.address,
          paymentDays,
        });
        session.clear(tenantId, lineUserId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 已新增供應商：${pc.draft.name}` }],
        });
      } catch (err) {
        session.clear(tenantId, lineUserId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `新增失敗：${(err as Error).message}` }],
        });
      }
      return true;
    }
  }
  return false;
}

async function replyPrompt(client: any, event: any, text: string): Promise<boolean> {
  await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text }] });
  return true;
}

// ---------- Command entry ----------

export async function handleManagementCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;

  switch (action) {
    case 'management:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'flex', altText: '管理選單', contents: rootMenu() }],
      });
      return;

    // ---------- Employee ----------
    case 'management:employee':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'flex', altText: '員工管理', contents: employeeMenu() }],
      });
      return;

    case 'management:employee:list':
      return listEmployees(client, event, tenantId);

    case 'management:employee:add': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      if (!employee.lineUserId) return;
      startCreate(tenantId, employee.lineUserId, 'mgmt:emp:add');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '開始新增員工。\n請輸入員工姓名：' }],
      });
      return;
    }

    case 'management:employee:deactivate': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      const employees = await prisma.employee.findMany({
        where: { tenantId, isActive: true, NOT: { id: employee.id } },
        orderBy: { employeeId: 'asc' }, take: 10,
      });
      return replyDeactivateCarousel(client, event, '停用員工', employees.map((e) => ({
        id: e.id, title: `${e.name}（${e.employeeId}）`, sub: `權限 ${e.role}`,
      })), 'management:employee:deactivate-confirm');
    }

    case 'management:employee:deactivate-confirm': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      const id = params.get('id');
      if (!id) return;
      const e = await prisma.employee.update({ where: { id }, data: { isActive: false } });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 已停用員工：${e.name}` }],
      });
      return;
    }

    // ---------- Supplier ----------
    case 'management:supplier':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'flex', altText: '供應商管理', contents: supplierMenu() }],
      });
      return;

    case 'management:supplier:list':
      return listSuppliers(client, event, tenantId);

    case 'management:supplier:add': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      if (!employee.lineUserId) return;
      startCreate(tenantId, employee.lineUserId, 'mgmt:sup:add');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '開始新增供應商。\n請輸入供應商名稱：' }],
      });
      return;
    }

    case 'management:supplier:deactivate': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      const suppliers = await supplierService.list(tenantId);
      return replyDeactivateCarousel(client, event, '停用供應商', suppliers.slice(0, 10).map((s) => ({
        id: s.id, title: s.name, sub: s.phone ?? '',
      })), 'management:supplier:deactivate-confirm');
    }

    case 'management:supplier:deactivate-confirm': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      const id = params.get('id');
      if (!id) return;
      const s = await supplierService.deactivate(tenantId, id);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 已停用供應商：${s.name}` }],
      });
      return;
    }

    // ---------- Customer ----------
    case 'management:customer':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'flex', altText: '客戶管理', contents: customerMenu() }],
      });
      return;

    case 'management:customer:list':
      return listCustomers(client, event, tenantId, employee);

    case 'management:customer:add': {
      if (!canCreateCustomer(employee)) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '⛔ 僅業務或管理員可新增客戶。' }],
        });
        return;
      }
      const hasVision = !!process.env.GOOGLE_VISION_API_KEY;
      const body = hasVision
        ? '📷 請拍攝客戶名片正面並傳送到此聊天室。\n\n系統會自動辨識欄位資料（公司、聯絡人、電話、Email、地址、統編），送出後會請您確認再建立。'
        : '⚠️ 本系統尚未設定名片 OCR（缺 GOOGLE_VISION_API_KEY）。\n請以文字新增客戶——\n直接輸入「新增客戶 <公司名> / <聯絡人> / <電話> / <Email> / <統編> / <地址>」\n例：新增客戶 毅金精密 / 陳先生 / 0912345678 / chen@ex.com / 12345678 / 台北市…';
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: body }],
      });
      return;
    }

    case 'management:customer:deactivate': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      const customers = await customerService.list(tenantId);
      return replyDeactivateCarousel(client, event, '停用客戶', customers.slice(0, 10).map((c) => ({
        id: c.id, title: c.name, sub: c.contactName ?? '',
      })), 'management:customer:deactivate-confirm');
    }

    case 'management:customer:deactivate-confirm': {
      if (!isAdmin(employee)) return denyNonAdmin(client, event);
      const id = params.get('id');
      if (!id) return;
      const c = await customerService.deactivate(tenantId, id);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 已停用客戶：${c.name}` }],
      });
      return;
    }

    default:
      logger.warn(`Unknown management action: ${action}`);
  }
}

// ---------- Listing helpers ----------

async function listEmployees(client: any, event: any, tenantId: string): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { tenantId, isActive: true },
    orderBy: { employeeId: 'asc' }, take: 30,
  });
  if (!employees.length) {
    await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '目前沒有員工資料。' }] });
    return;
  }
  const lines = employees.map((e, i) => {
    const bits = [`${i + 1}. ${e.name}（${e.employeeId}）`, `   權限：${e.role}`];
    if (e.phone) bits.push(`   電話：${e.phone}`);
    if (e.email) bits.push(`   Email：${e.email}`);
    bits.push(`   LINE 綁定：${e.lineUserId ? '✅' : '未綁定'}`);
    return bits.join('\n');
  }).join('\n\n');
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `【員工資料與權限】\n\n${truncate(lines)}` }],
  });
}

async function listSuppliers(client: any, event: any, tenantId: string): Promise<void> {
  const suppliers = await supplierService.list(tenantId);
  if (!suppliers.length) {
    await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '目前沒有供應商資料。' }] });
    return;
  }
  const lines = suppliers.slice(0, 30).map((s, i) => {
    const bits = [`${i + 1}. ${s.name}`];
    if (s.contactName) bits.push(`   聯絡人：${s.contactName}`);
    if (s.phone) bits.push(`   電話：${s.phone}`);
    if (s.taxId) bits.push(`   統一編號：${s.taxId}`);
    if (s.paymentDays != null) bits.push(`   付款天數：${s.paymentDays}`);
    return bits.join('\n');
  }).join('\n\n');
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `【供應商清單】\n\n${truncate(lines)}` }],
  });
}

async function listCustomers(client: any, event: any, tenantId: string, employee: any): Promise<void> {
  // SALES 只看自己建的；ADMIN 看全部；其他角色看全部（唯讀）
  const filter = employee.role === 'SALES' ? { createdBy: employee.id } : {};
  const customers = await customerService.list(tenantId, filter);
  if (!customers.length) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: employee.role === 'SALES' ? '您目前尚未建立任何客戶。' : '目前沒有客戶資料。' }],
    });
    return;
  }
  const lines = customers.slice(0, 30).map((c, i) => {
    const bits = [`${i + 1}. ${c.name}`];
    if (c.contactName) bits.push(`   聯絡人：${c.contactName}`);
    if (c.phone) bits.push(`   電話：${c.phone}`);
    if (c.taxId) bits.push(`   統一編號：${c.taxId}`);
    if (c.paymentDays != null) bits.push(`   付款天數：${c.paymentDays}`);
    if (c.grade) bits.push(`   等級：${c.grade}`);
    return bits.join('\n');
  }).join('\n\n');
  const header = employee.role === 'SALES' ? '【我的客戶】' : '【客戶清單】';
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `${header}\n\n${truncate(lines)}` }],
  });
}

// ---------- Deactivate carousel ----------

async function replyDeactivateCarousel(
  client: any, event: any, title: string,
  items: { id: string; title: string; sub: string }[],
  confirmAction: string,
): Promise<void> {
  if (!items.length) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '沒有可停用的項目。' }],
    });
    return;
  }
  const bubbles = items.map((it) => ({
    type: 'bubble' as const,
    size: 'kilo' as const,
    body: {
      type: 'box' as const, layout: 'vertical' as const, spacing: 'sm' as const,
      contents: [
        { type: 'text' as const, text: it.title, weight: 'bold' as const, wrap: true, size: 'md' as const },
        ...(it.sub ? [{ type: 'text' as const, text: it.sub, color: '#666666', size: 'sm' as const, wrap: true }] : []),
      ],
    },
    footer: {
      type: 'box' as const, layout: 'vertical' as const,
      contents: [{
        type: 'button' as const, style: 'primary' as const, color: '#C62828',
        action: { type: 'postback' as const, label: '停用', data: `action=${confirmAction}&id=${it.id}`, displayText: `停用 ${it.title}` },
      }],
    },
  }));
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'flex', altText: title, contents: { type: 'carousel', contents: bubbles } }],
  });
}

// ---------- Flex menus ----------

function btn(label: string, data: string, color: string) {
  return {
    type: 'button' as const,
    style: 'primary' as const,
    color,
    action: { type: 'postback' as const, data, label, displayText: label },
  };
}

function rootMenu() {
  return {
    type: 'bubble' as const,
    body: {
      type: 'box' as const, layout: 'vertical' as const, spacing: 'md',
      contents: [
        { type: 'text', text: '管理選單', weight: 'bold', size: 'lg' },
        { type: 'separator' },
        btn('員工資料與權限', 'action=management:employee', '#1565C0'),
        btn('供應商管理',     'action=management:supplier', '#6A1B9A'),
        btn('客戶管理',       'action=management:customer', '#2E7D32'),
      ],
    },
  };
}

function employeeMenu() {
  return {
    type: 'bubble' as const,
    body: {
      type: 'box' as const, layout: 'vertical' as const, spacing: 'md',
      contents: [
        { type: 'text', text: '員工管理', weight: 'bold', size: 'lg' },
        { type: 'text', text: '新增 / 停用 需管理員權限', size: 'sm', color: '#888888' },
        { type: 'separator' },
        btn('員工清單', 'action=management:employee:list', '#1565C0'),
        btn('新增員工', 'action=management:employee:add', '#2E7D32'),
        btn('停用員工', 'action=management:employee:deactivate', '#C62828'),
      ],
    },
  };
}

function supplierMenu() {
  return {
    type: 'bubble' as const,
    body: {
      type: 'box' as const, layout: 'vertical' as const, spacing: 'md',
      contents: [
        { type: 'text', text: '供應商管理', weight: 'bold', size: 'lg' },
        { type: 'text', text: '新增 / 停用 需管理員權限', size: 'sm', color: '#888888' },
        { type: 'separator' },
        btn('供應商清單', 'action=management:supplier:list', '#6A1B9A'),
        btn('新增供應商', 'action=management:supplier:add', '#2E7D32'),
        btn('停用供應商', 'action=management:supplier:deactivate', '#C62828'),
      ],
    },
  };
}

function customerMenu() {
  return {
    type: 'bubble' as const,
    body: {
      type: 'box' as const, layout: 'vertical' as const, spacing: 'md',
      contents: [
        { type: 'text', text: '客戶管理', weight: 'bold', size: 'lg' },
        { type: 'text', text: '新增：業務 / 管理員；停用：管理員', size: 'sm', color: '#888888' },
        { type: 'separator' },
        btn('客戶清單', 'action=management:customer:list', '#2E7D32'),
        btn('新增客戶（拍名片）', 'action=management:customer:add', '#1565C0'),
        btn('停用客戶', 'action=management:customer:deactivate', '#C62828'),
      ],
    },
  };
}

function truncate(s: string): string {
  if (s.length <= 4800) return s;
  return s.slice(0, 4800) + '\n…（僅顯示前 30 筆）';
}
