import { messagingApi } from '@line/bot-sdk';
import { config } from '../config/index.js';

const { MessagingApiClient } = messagingApi;

// Default LINE client (for single-tenant or fallback)
let defaultClient: InstanceType<typeof MessagingApiClient> | null = null;

export function getLineClient(accessToken?: string): InstanceType<typeof MessagingApiClient> {
  const token = accessToken || config.line.channelAccessToken;
  if (!token) {
    throw new Error('LINE channel access token not configured');
  }

  if (!accessToken && defaultClient) {
    return defaultClient;
  }

  const client = new MessagingApiClient({ channelAccessToken: token });

  if (!accessToken) {
    defaultClient = client;
  }

  return client;
}
