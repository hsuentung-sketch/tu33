import { logger } from '../../shared/logger.js';

export async function handlePurchaseCommand(action: string, ctx: any): Promise<void> {
  const { client, event } = ctx;

  switch (action) {
    case 'purchase:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '進貨管理：\n• 新增進貨單\n• 進貨紀錄\n• 查詢進貨',
        }],
      });
      break;

    default:
      logger.warn(`Unknown purchase action: ${action}`);
  }
}
