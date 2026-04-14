import { logger } from '../../shared/logger.js';

export async function handleSalesCommand(action: string, ctx: any): Promise<void> {
  const { client, event } = ctx;

  switch (action) {
    case 'sales:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '銷貨管理：\n• 新增銷貨單\n• 銷貨紀錄\n• 查詢銷貨',
        }],
      });
      break;

    default:
      logger.warn(`Unknown sales action: ${action}`);
  }
}
