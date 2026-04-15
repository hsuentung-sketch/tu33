import { logger } from '../../shared/logger.js';
import * as customerService from '../../modules/master/customer/customer.service.js';
import * as supplierService from '../../modules/master/supplier/supplier.service.js';
import { prisma } from '../../shared/prisma.js';

/**
 * 管理選單：員工、供應商、客戶。
 * 目前以唯讀列表為主（LINE chat 上的建立/編輯流程較繁瑣，
 * 留給 LIFF 或後台介面；此處先提供查詢）。
 */
export async function handleManagementCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId } = ctx;

  switch (action) {
    case 'management:menu': {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: '管理選單',
          contents: menuFlex(),
        }],
      });
      return;
    }

    case 'management:employee': {
      const employees = await prisma.employee.findMany({
        where: { tenantId, isActive: true },
        orderBy: { employeeId: 'asc' },
        take: 30,
      });
      if (!employees.length) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有員工資料。' }],
        });
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
      return;
    }

    case 'management:supplier': {
      const suppliers = await supplierService.list(tenantId);
      if (!suppliers.length) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有供應商資料。' }],
        });
        return;
      }
      const lines = suppliers.slice(0, 30).map((s, i) => {
        const bits = [`${i + 1}. ${s.name}`];
        if (s.type) bits.push(`   類型：${s.type}`);
        if (s.contactName) bits.push(`   聯絡人：${s.contactName}`);
        if (s.phone) bits.push(`   電話：${s.phone}`);
        if (s.taxId) bits.push(`   統一編號：${s.taxId}`);
        if (s.paymentDays != null) bits.push(`   付款天數：${s.paymentDays}`);
        return bits.join('\n');
      }).join('\n\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `【供應商管理】\n\n${truncate(lines)}` }],
      });
      return;
    }

    case 'management:customer': {
      const customers = await customerService.list(tenantId);
      if (!customers.length) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有客戶資料。' }],
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
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `【客戶管理】\n\n${truncate(lines)}` }],
      });
      return;
    }

    default:
      logger.warn(`Unknown management action: ${action}`);
  }
}

function truncate(s: string): string {
  if (s.length <= 4800) return s;
  return s.slice(0, 4800) + '\n…（資料過多，僅顯示前 30 筆）';
}

function menuFlex() {
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
        { type: 'text', text: '管理選單', weight: 'bold', size: 'lg' },
        { type: 'text', text: '選擇要管理的項目', size: 'sm', color: '#666666' },
        { type: 'separator' },
        btn('員工資料與權限', 'action=management:employee', '#1565C0'),
        btn('供應商管理',     'action=management:supplier', '#6A1B9A'),
        btn('客戶管理',       'action=management:customer', '#2E7D32'),
      ],
    },
  };
}
