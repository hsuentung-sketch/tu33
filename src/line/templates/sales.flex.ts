import type { messagingApi } from '@line/bot-sdk';

type FlexBubble = messagingApi.FlexBubble;

export function salesOrderSummaryBubble(data: {
  orderNo: string;
  customerName: string;
  totalAmount: number;
  itemCount: number;
  status: string;
  pdfUrl?: string;
  salesOrderId: string;
}): FlexBubble {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '銷貨單', weight: 'bold', size: 'lg' },
        { type: 'text', text: data.orderNo, size: 'sm', color: '#888888' },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'sm',
          contents: [
            row('客戶', data.customerName),
            row('品項數', String(data.itemCount)),
            row('總計', `$${data.totalAmount.toLocaleString('zh-TW')}`),
            row('狀態', data.status),
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...(data.pdfUrl
          ? [
              {
                type: 'button' as const,
                style: 'primary' as const,
                action: { type: 'uri' as const, label: '下載 PDF', uri: data.pdfUrl },
              },
            ]
          : []),
        {
          type: 'button',
          style: 'secondary',
          action: {
            type: 'postback',
            label: '標記為已出貨',
            data: `action=salesOrder:deliver&id=${data.salesOrderId}`,
          },
        },
      ],
    },
  };
}

function row(label: string, value: string) {
  return {
    type: 'box' as const,
    layout: 'baseline' as const,
    spacing: 'sm' as const,
    contents: [
      { type: 'text' as const, text: label, color: '#888888', size: 'sm', flex: 2 },
      { type: 'text' as const, text: value, size: 'sm', flex: 5, wrap: true },
    ],
  };
}
