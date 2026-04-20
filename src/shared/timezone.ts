/**
 * Asia/Taipei date helpers.
 *
 * Why: Fly.io containers run in UTC, but the business day, document numbers,
 * AR billing period, and daily cron filenames must use Asia/Taipei. Using
 * raw `new Date().getFullYear()` etc. causes wrong-day bugs between
 * 00:00-08:00 UTC (00:00-08:00 Taipei previous calendar day).
 *
 * Implementation note: uses Intl.DateTimeFormat with Taipei timezone rather
 * than a heavyweight tz library — zero deps, correct year-round (Taipei has
 * no DST), and already available in Node 20.
 */

const TAIPEI = 'Asia/Taipei';

function parts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
  };
}

export function taipeiNow(d: Date = new Date()): { year: number; month: number; day: number; hour: number; minute: number } {
  return parts(d);
}

/** "20260420" — for document numbers. */
export function taipeiDateStamp(d: Date = new Date()): string {
  const p = parts(d);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/** "2026-04-20" — for backup filenames. */
export function taipeiDateSlug(d: Date = new Date()): string {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Return UTC instants representing the start and end of the current
 * Taipei calendar day, for Prisma `{gte, lt}` filters on createdAt.
 * Taipei is UTC+8 year-round — simpler than a generic tz conversion.
 */
export function taipeiDayWindow(d: Date = new Date()): { start: Date; end: Date } {
  const p = parts(d);
  // UTC equivalent of (Taipei YYYY-MM-DD 00:00:00) = (YYYY-MM-DD (-1) 16:00:00 UTC)
  const startUtc = Date.UTC(p.year, p.month - 1, p.day, -8, 0, 0);
  const endUtc = startUtc + 24 * 60 * 60 * 1000;
  return { start: new Date(startUtc), end: new Date(endUtc) };
}
