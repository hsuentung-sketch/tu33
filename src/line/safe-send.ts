/**
 * safeSend — LINE reply-with-push-fallback.
 *
 * LINE replyToken has a 30-second TTL and is single-use. Slow handlers
 * (DB transactions, AI/OCR calls, external APIs) that eventually call
 * replyMessage() will intermittently 400 when the token has expired.
 * When that happens we still want the user to see the result, so we
 * push the same payload to the user's LINE userId.
 *
 * Usage:
 *   const send = makeSafeSend({ client, replyToken, lineUserId, source });
 *   await send([{ type: 'text', text: '...' }]);
 */
import type { messagingApi } from '@line/bot-sdk';
import { logger } from '../shared/logger.js';
import { writeErrorLog } from '../shared/error-log.js';

export interface SafeSendOptions {
  client: messagingApi.MessagingApiClient;
  replyToken: string;
  lineUserId?: string | null;
  /** Label for logs, e.g. "sales:confirm" — helps debug in ErrorLog. */
  source: string;
}

export function makeSafeSend(opts: SafeSendOptions) {
  const { client, replyToken, lineUserId, source } = opts;
  let replyUsed = false;

  return async function send(messages: messagingApi.Message[]): Promise<void> {
    if (!replyUsed) {
      replyUsed = true;
      try {
        await client.replyMessage({ replyToken, messages });
        return;
      } catch (err) {
        logger.warn('safeSend: replyMessage failed, falling back to push', {
          source,
          error: (err as Error).message,
        });
        // fall through to push
      }
    }

    if (!lineUserId) {
      // Rare: user triggered via a non-user event (group). Log and give up.
      await writeErrorLog({
        level: 'error',
        source: `line.safeSend.${source}`,
        message: 'reply expired and no lineUserId to push to',
      });
      return;
    }

    try {
      await client.pushMessage({ to: lineUserId, messages });
    } catch (pushErr) {
      logger.error('safeSend: pushMessage also failed', {
        source,
        error: (pushErr as Error).message,
      });
      await writeErrorLog({
        level: 'error',
        source: `line.safeSend.${source}`,
        message: `reply+push both failed: ${(pushErr as Error).message}`,
      });
    }
  };
}
