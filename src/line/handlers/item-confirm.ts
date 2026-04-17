/**
 * Shared "pending item confirmation" card used by sales and purchase
 * chat flows. After the user provides 品名/數量/單價 we park the draft
 * in session.data.pendingItem and send this card for final confirmation,
 * optionally letting them attach a note first.
 */
export async function sendItemConfirmCard(
  client: any,
  replyToken: string,
  kind: 'sales' | 'purchase',
  pi: { productName: string; quantity: number; unitPrice: number; note?: string },
): Promise<void> {
  const subtotal = pi.quantity * pi.unitPrice;
  const lines = [
    `品名：${pi.productName}`,
    `數量：${pi.quantity}`,
    `單價：$${Number(pi.unitPrice).toLocaleString('zh-TW')}`,
    `小計：$${subtotal.toLocaleString('zh-TW')}`,
  ];
  if (pi.note) lines.push(`備註：${pi.note}`);
  // LINE buttons template `text` limit is 160 chars when no title.
  const text = lines.join('\n').slice(0, 160);

  const actions = pi.note
    ? [
        { type: 'postback' as const, label: '✅ 加入', data: `action=${kind}:item-confirm` },
        { type: 'postback' as const, label: '✖ 取消', data: `action=${kind}:item-cancel` },
      ]
    : [
        { type: 'postback' as const, label: '📝 加備註', data: `action=${kind}:item-add-note` },
        { type: 'postback' as const, label: '✅ 直接加入', data: `action=${kind}:item-confirm` },
        { type: 'postback' as const, label: '✖ 取消', data: `action=${kind}:item-cancel` },
      ];

  await client.replyMessage({
    replyToken,
    messages: [{
      type: 'template',
      altText: '確認品項',
      template: { type: 'buttons', text, actions },
    }],
  });
}
