import { logger } from '../../shared/logger.js';

export async function handleQuotationCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, employee } = ctx;

  switch (action) {
    case 'quotation:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '報價管理：\n• 新增報價單\n• 報價追蹤\n• 查詢報價',
        }],
      });
      break;

    default:
      logger.warn(`Unknown quotation action: ${action}`);
  }
}
