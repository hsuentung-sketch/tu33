/**
 * RFC 5905 NTP client（v2.11.0+）
 *
 * 替換原本用 worldtimeapi.org HTTP 對時的做法。財政部電子發票「自行檢測表」
 * 項 3 對時要求 NTP server，HTTP API 不被認可。
 *
 * 設計：
 *  - 用 Node `dgram` 直接打 UDP 123，發 48-byte client packet，
 *    解 server 回的 transmit timestamp。
 *  - 主 server：`time.stdtime.gov.tw`（國家時間與頻率標準實驗室）— 與 TWNIC / GSA 同源。
 *  - Fallback chain：tw.pool.ntp.org → pool.ntp.org → worldtimeapi.org HTTP（最後保底）
 *  - UDP timeout 預設 3 秒。
 *
 * 為什麼不用 npm 的 ntp-client：上次 update 2018，遺棄狀態；自寫 ~50 行清楚許多。
 *
 * Fly.io UDP egress：實測允許 outbound UDP 123。若部署環境擋 UDP（如 AWS Lambda），
 * fallback chain 會自動降級到 HTTPS。
 */

import dgram from 'node:dgram';
import { logger } from './logger.js';

const NTP_PORT = 123;
const NTP_PACKET_SIZE = 48;
/** Seconds between NTP epoch (1900-01-01) and Unix epoch (1970-01-01) */
const NTP_TO_UNIX_OFFSET = 2208988800;

const DEFAULT_SERVERS = [
  'time.stdtime.gov.tw',
  'tw.pool.ntp.org',
  'pool.ntp.org',
];

const HTTP_FALLBACK_URL = 'https://worldtimeapi.org/api/timezone/Asia/Taipei';

export interface NtpResult {
  /** Server 回的時間（Unix ms） */
  remoteMs: number;
  /** 用了哪個 server / fallback method */
  source: string;
  /** 本機送請求 → 收回應的 RTT（ms），用來推算單向延遲 */
  rttMs: number;
}

/**
 * 對單一 NTP server 發 UDP 請求。
 * 回傳 remote time (Unix ms) 與 RTT；失敗回 null。
 */
function queryUdp(server: string, timeoutMs: number): Promise<NtpResult | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(NTP_PACKET_SIZE);
    // byte 0：LI=0 (no leap warn), VN=3 (NTP v3, 普遍兼容), Mode=3 (client)
    packet[0] = 0x1b;

    const start = Date.now();
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* noop */ }
      resolve(null);
    }, timeoutMs);

    socket.once('error', () => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* noop */ }
      resolve(null);
    });

    socket.once('message', (msg) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* noop */ }
      if (msg.length < NTP_PACKET_SIZE) {
        resolve(null);
        return;
      }
      // Transmit timestamp 在 bytes 40-47（server 送出的時間）
      const seconds = msg.readUInt32BE(40);
      const fraction = msg.readUInt32BE(44);
      if (seconds === 0) {
        // 沒填 → 無效
        resolve(null);
        return;
      }
      const remoteMs = (seconds - NTP_TO_UNIX_OFFSET) * 1000
        + Math.round((fraction / 0x100000000) * 1000);
      const rttMs = Date.now() - start;
      // 把單向延遲加回去（粗略補償）
      const adjustedRemoteMs = remoteMs + Math.round(rttMs / 2);
      resolve({ remoteMs: adjustedRemoteMs, source: `ntp://${server}`, rttMs });
    });

    socket.send(packet, 0, NTP_PACKET_SIZE, NTP_PORT, server, (err) => {
      if (err) {
        clearTimeout(timer);
        try { socket.close(); } catch { /* noop */ }
        resolve(null);
      }
    });
  });
}

/** HTTPS 保底（UDP 全擋的環境用）。 */
async function queryHttpFallback(timeoutMs: number): Promise<NtpResult | null> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(HTTP_FALLBACK_URL, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = (await res.json()) as { datetime?: string };
    if (!data.datetime) return null;
    const remoteMs = new Date(data.datetime).getTime();
    return { remoteMs, source: `http://worldtimeapi.org`, rttMs: Date.now() - start };
  } catch {
    return null;
  }
}

/**
 * 試一輪 servers，回第一個成功的；全失敗回 null。
 * @param servers 可覆寫的 server 清單；預設 DEFAULT_SERVERS
 * @param timeoutMs 每台 server 的 UDP timeout，預設 3000
 */
export async function queryNtp(
  servers: string[] = DEFAULT_SERVERS,
  timeoutMs = 3000,
): Promise<NtpResult | null> {
  for (const s of servers) {
    const r = await queryUdp(s, timeoutMs);
    if (r) return r;
    logger.warn('ntp: server 不可達，試下一台', { server: s, timeoutMs });
  }
  // 最後 fallback：HTTPS
  const httpResult = await queryHttpFallback(timeoutMs);
  if (httpResult) {
    logger.warn('ntp: 所有 UDP NTP server 失敗，使用 HTTPS fallback', { source: httpResult.source });
    return httpResult;
  }
  return null;
}

/**
 * 對時：回本機與 NTP server 的時鐘差（ms）。
 * 正值 = 本機快；負值 = 本機慢。
 */
export async function getClockSkew(): Promise<{ skewMs: number | null; source?: string }> {
  const r = await queryNtp();
  if (!r) return { skewMs: null };
  return { skewMs: Date.now() - r.remoteMs, source: r.source };
}
