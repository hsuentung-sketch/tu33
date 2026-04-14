/**
 * Download a LINE message's binary content (audio / image / video).
 * The messaging client doesn't expose this directly, so we hit the
 * Data API with the tenant's channel access token.
 */
export async function downloadLineContent(
  messageId: string,
  accessToken: string,
): Promise<Buffer> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LINE content download failed: ${res.status} ${await res.text()}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
