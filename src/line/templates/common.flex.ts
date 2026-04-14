import type { messagingApi } from '@line/bot-sdk';

type FlexBubble = messagingApi.FlexBubble;
type FlexMessage = messagingApi.FlexMessage;

export function textBubble(title: string, body: string): FlexBubble {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: body, wrap: true, margin: 'md', size: 'sm' },
      ],
    },
  };
}

export function confirmBubble(opts: {
  title: string;
  summary: string;
  confirmLabel: string;
  confirmData: string;
  cancelLabel?: string;
  cancelData?: string;
}): FlexBubble {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: opts.title, weight: 'bold', size: 'lg' },
        { type: 'text', text: opts.summary, wrap: true, margin: 'md', size: 'sm' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          action: {
            type: 'postback',
            label: opts.cancelLabel ?? '取消',
            data: opts.cancelData ?? 'action=cancel',
          },
        },
        {
          type: 'button',
          style: 'primary',
          action: {
            type: 'postback',
            label: opts.confirmLabel,
            data: opts.confirmData,
          },
        },
      ],
    },
  };
}

export function wrapFlex(altText: string, bubble: FlexBubble): FlexMessage {
  return { type: 'flex', altText, contents: bubble };
}

export function listBubble(opts: {
  title: string;
  items: Array<{ label: string; subtext?: string; data: string }>;
}): FlexBubble {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: opts.title, weight: 'bold', size: 'lg' },
        { type: 'separator', margin: 'md' },
        ...opts.items.map((item) => ({
          type: 'box' as const,
          layout: 'vertical' as const,
          margin: 'md' as const,
          contents: [
            {
              type: 'text' as const,
              text: item.label,
              weight: 'bold' as const,
              size: 'sm' as const,
              wrap: true,
            },
            ...(item.subtext
              ? [{ type: 'text' as const, text: item.subtext, size: 'xs' as const, color: '#888888', wrap: true }]
              : []),
            {
              type: 'button' as const,
              style: 'link' as const,
              height: 'sm' as const,
              action: { type: 'postback' as const, label: '選擇', data: item.data },
            },
          ],
        })),
      ],
    },
  };
}
