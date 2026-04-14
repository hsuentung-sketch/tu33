import { logger } from '../../shared/logger.js';
import { fuzzySearch } from '../../shared/search.js';

export async function handleMasterCommand(action: string, ctx: any): Promise<void> {
  const { client, event, tenantId, params } = ctx;

  switch (action) {
    case 'master:search': {
      const query = params.get('q');
      if (!query) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '請輸入搜尋關鍵字，例如：查詢 毅金' }],
        });
        return;
      }

      const results = await fuzzySearch(tenantId, query);
      if (results.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `找不到「${query}」相關資料。` }],
        });
        return;
      }

      const typeLabels: Record<string, string> = {
        customer: '客戶',
        product: '產品',
        supplier: '供應��',
      };

      const text = results
        .map((r, i) => `${i + 1}. [${typeLabels[r.type] || r.type}] ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
        .join('\n');

      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `搜尋結果：\n${text}` }],
      });
      break;
    }

    default:
      logger.warn(`Unknown master action: ${action}`);
  }
}
