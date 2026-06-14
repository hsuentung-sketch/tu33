import * as session from '../session.js';
import { prisma } from '../../shared/prisma.js';
import * as refurbishService from '../../modules/inventory/refurbish/refurbish.service.js';
import * as productService from '../../modules/master/product/product.service.js';
import { makeSafeSend } from '../safe-send.js';

function infoRow(label: string, value: string): any {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#888888', flex: 2 },
      { type: 'text', text: value, size: 'sm', align: 'end', flex: 3 },
    ],
  };
}

export async function handleRefurbishCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee, params } = ctx;

  switch (action) {
    case 'refurbish:complete': {
      const orderId = params.get('id');
      if (!orderId) return;
      try {
        const order = await refurbishService.complete(tenantId, orderId);
        const machine = await prisma.product.findUnique({
          where: { id: order.usedMachineId },
          select: { name: true, purchaseCost: true, refurbishCost: true },
        });
        const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'refurbish' });
        await safeSend([{
          type: 'text',
          text: `整備完成！\n機台：${machine?.name}\n整備成本：$${Number(order.totalCost).toLocaleString('zh-TW')}\n底價：$${(Number(machine?.purchaseCost ?? 0) + Number(machine?.refurbishCost ?? 0)).toLocaleString('zh-TW')}`,
        }]);
      } catch (err) {
        const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'refurbish' });
        await safeSend([{ type: 'text', text: `整備完成失敗：${(err as Error).message}` }]);
      }
      break;
    }

    case 'refurbish:cancel': {
      const orderId = params.get('id');
      if (!orderId) return;
      try {
        await refurbishService.cancel(tenantId, orderId);
        const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'refurbish' });
        await safeSend([{ type: 'text', text: '整備工單已取消。' }]);
      } catch (err) {
        const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'refurbish' });
        await safeSend([{ type: 'text', text: `取消失敗：${(err as Error).message}` }]);
      }
      break;
    }
  }
}

/**
 * Handle text commands for refurbish flow.
 * - 「整備 <品名>」→ search USED_MACHINE, create RefurbishOrder
 * - 「加零件 <品名> <數量> @<單價>」→ add RefurbishOrderItem
 * - 「整備完成」→ complete order
 * - 「整備取消」→ cancel order
 */
export async function handleRefurbishText(text: string, ctx: any): Promise<boolean> {
  const { client, event, tenantId, employee } = ctx;
  const lineUserId = employee.lineUserId as string;
  const safeSend = makeSafeSend({ client, replyToken: event.replyToken, lineUserId: employee.lineUserId, source: 'refurbish' });

  const s = session.get(tenantId, lineUserId);

  // Active refurbish session — handle sub-commands
  if (s?.flow === 'refurbish:create') {
    // 「加零件 火星塞 3 @50」
    const addMatch = text.match(/^加零件\s+(.+?)\s+(\d+)\s*@\s*(\d+(?:\.\d+)?)$/);
    if (addMatch) {
      const [, partName, qtyStr, costStr] = addMatch;
      const quantity = Number(qtyStr);
      const unitCost = Number(costStr);
      const orderId = s.data.refurbishOrderId;
      if (!orderId) return false;

      const parts = await productService.findByNameOrCode(tenantId, partName);
      if (parts.length === 0) {
        await safeSend([{ type: 'text', text: `找不到零件「${partName}」。` }]);
        return true;
      }
      const part = parts[0];

      try {
        await refurbishService.addItem(tenantId, orderId, {
          productId: part.id,
          quantity,
          unitCost,
          createdBy: employee.id,
        });
        await safeSend([{
          type: 'text',
          text: `已加零件：${part.name} x${quantity} @$${unitCost}\n（庫存已扣除）\n\n繼續輸入「加零件 ...」或「整備完成」。`,
        }]);
      } catch (err) {
        await safeSend([{ type: 'text', text: `加零件失敗：${(err as Error).message}` }]);
      }
      return true;
    }

    // 「整備完成」
    if (text === '整備完成') {
      const orderId = s.data.refurbishOrderId;
      if (!orderId) return false;
      session.clear(tenantId, lineUserId);
      try {
        const order = await refurbishService.complete(tenantId, orderId);
        const machine = await prisma.product.findUnique({
          where: { id: order.usedMachineId },
          select: { name: true, purchaseCost: true, refurbishCost: true },
        });
        await safeSend([{
          type: 'text',
          text: `整備完成！\n機台：${machine?.name}\n整備成本：$${Number(order.totalCost).toLocaleString('zh-TW')}\n底價：$${(Number(machine?.purchaseCost ?? 0) + Number(machine?.refurbishCost ?? 0)).toLocaleString('zh-TW')}`,
        }]);
      } catch (err) {
        await safeSend([{ type: 'text', text: `整備完成失敗：${(err as Error).message}` }]);
      }
      return true;
    }

    // 「整備取消」
    if (text === '整備取消') {
      const orderId = s.data.refurbishOrderId;
      if (!orderId) return false;
      session.clear(tenantId, lineUserId);
      try {
        await refurbishService.cancel(tenantId, orderId);
        await safeSend([{ type: 'text', text: '整備工單已取消。' }]);
      } catch (err) {
        await safeSend([{ type: 'text', text: `取消失敗：${(err as Error).message}` }]);
      }
      return true;
    }

    return false;
  }

  // 「整備 <品名>」→ start new refurbish order
  const startMatch = text.match(/^整備\s+(.+)$/);
  if (startMatch) {
    const machineName = startMatch[1].trim();
    const machines = await prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { name: { contains: machineName, mode: 'insensitive' } },
          { code: { contains: machineName, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 5,
    });

    if (machines.length === 0) {
      await safeSend([{ type: 'text', text: `找不到機台「${machineName}」。` }]);
      return true;
    }

    const machine = machines[0];
    try {
      const order = await refurbishService.create(tenantId, {
        usedMachineId: machine.id,
        createdBy: employee.id,
      });

      session.set(tenantId, lineUserId, {
        flow: 'refurbish:create',
        step: 'items',
        data: {
          items: [],
          refurbishOrderId: order.id,
          refurbishMachineName: machine.name,
        },
        updatedAt: Date.now(),
      });

      await safeSend([{
        type: 'text',
        text: `已建立整備工單\n機台：${machine.name}\n\n請輸入零件：\n加零件 <品名> <數量> @<單價>\n例：加零件 火星塞 3 @50\n\n完成時輸入「整備完成」\n取消輸入「整備取消」`,
      }]);
    } catch (err) {
      await safeSend([{ type: 'text', text: `建立整備工單失敗：${(err as Error).message}` }]);
    }
    return true;
  }

  return false;
}
