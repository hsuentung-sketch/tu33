/**
 * In-memory sliding-window rate limiter.
 *
 * Good enough for single-instance Fly deployments (we run 1 machine).
 * If/when horizontal scaling arrives, swap storage for Redis without
 * touching call sites.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * @param key    logical throttle key, e.g. `login:${ip}:${employeeId}`
 * @param limit  max calls allowed per window
 * @param windowMs window length in ms
 * @returns true if request allowed, false if over limit
 */
export function tryConsume(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Periodic cleanup so the map doesn't grow forever. Keep stale buckets up to 1 hour. */
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [k, b] of buckets) {
    if (b.windowStart < cutoff) buckets.delete(k);
  }
}, 600_000).unref();
