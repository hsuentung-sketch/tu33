/**
 * Helper: run a transaction that creates a daily-numbered document and
 * retries on P2002 (unique violation on (tenantId, orderNo/quotationNo)).
 *
 * Why: `count(today)+1` is not race-safe. Two concurrent creates on the
 * same day both read N and both try to write N+1 → one fails with P2002.
 * Rather than serialize via advisory lock (Supabase pgbouncer doesn't
 * carry session locks well), retry with the next free number.
 *
 * Caller provides:
 *   - counter: (tx) => Promise<number>     // current count in today's window
 *   - createFn: (tx, orderNo) => Promise<T>
 * Helper: runs transaction, on P2002 retries up to `maxAttempts` (bumping seq).
 */
import { prisma } from './prisma.js';
import { generateDocumentNo } from './utils.js';
import { taipeiDayWindow } from './timezone.js';

// Extract the tx type from the extended client's $transaction callback.
// Using `Parameters<typeof prisma.$transaction>[0]` would give the callback
// itself; we want its first arg. This works for both vanilla and $extends()-ed
// PrismaClient, so the shared util doesn't need to know the exact shape.
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface DailyNumberOptions<T> {
  /** Count rows in today's Taipei window inside the tx. */
  counter: (tx: Tx, window: { start: Date; end: Date }) => Promise<number>;
  /** Perform the actual create. `orderNo` is supplied. */
  createFn: (tx: Tx, orderNo: string) => Promise<T>;
  maxAttempts?: number;
}

export async function createWithDailyNumber<T>(opts: DailyNumberOptions<T>): Promise<T> {
  const { counter, createFn, maxAttempts = 5 } = opts;
  const window = taipeiDayWindow();
  const now = new Date();

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const todayCount = await counter(tx, window);
        const orderNo = generateDocumentNo(now, todayCount + 1 + attempt);
        return await createFn(tx, orderNo);
      });
    } catch (err) {
      // Prisma P2002 = unique constraint violated; retry with next seq.
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`createWithDailyNumber: exhausted ${maxAttempts} attempts (last: ${(lastErr as Error)?.message ?? 'unknown'})`);
}
