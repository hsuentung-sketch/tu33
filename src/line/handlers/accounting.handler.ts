import { logger } from '../../shared/logger.js';

export async function handleAccountingCommand(action: string, ctx: any): Promise<void> {
  const { client, event } = ctx;

  switch (action) {
    case 'accounting:menu':
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '帳務管理：\n• 應收帳款\n• 應付帳款\n• 逾期提醒',
        }],
      });
      break;

    default:
      logger.warn(`Unknown accounting action: ${action}`);
  }
}
