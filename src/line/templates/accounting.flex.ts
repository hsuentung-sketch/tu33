import type { messagingApi } from '@line/bot-sdk';

type FlexBubble = messagingApi.FlexBubble;

export function receivableSummaryBubble(data: {
  customerName: string;
  items: Array<{
    month: string;
    amount: number;
    dueDate: string;
    status: 'ok' | 'warning' | 'overdue' | 'paid';
    statusMsg: string;
  }>;
}): FlexBubble {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `應收帳款 - ${data.customerName}`, weight: 'bold', size: 'md' },
        { type: 'separator', margin: 'md' },
        ...data.items.map((item) => ({
          type: 'box' as const,
          layout: 'vertical' as const,
          margin: 'md' as const,
          contents: [
            {
              type: 'box' as const,
              layout: 'baseline' as const,
              contents: [
                { type: 'text' as const, text: item.month, size: 'sm' as const, flex: 2 },
                {
                  type: 'text' as const,
                  text: `$${item.amount.toLocaleString('zh-TW')}`,
                  size: 'sm' as const,
                  flex: 3,
                  align: 'end' as const,
                },
              ],
            },
            {
              type: 'text' as const,
              text: `到期: ${item.dueDate} · ${item.statusMsg}`,
              size: 'xs' as const,
              color: statusColor(item.status),
            },
          ],
        })),
      ],
    },
  };
}

function statusColor(status: 'ok' | 'warning' | 'overdue' | 'paid'): string {
  switch (status) {
    case 'overdue':
      return '#D0342C';
    case 'warning':
      return '#E6A700';
    case 'paid':
      return '#27AE60';
    default:
      return '#888888';
  }
}
