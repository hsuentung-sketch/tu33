import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { getLineClient } from '../line/client.js';
import { logger } from '../shared/logger.js';
import { getTenantSettings } from '../shared/utils.js';

// Use a raw client here — the reminder job is read-only and runs outside
// any request context, so there's no audit user to tag.
const db = new PrismaClient({ log: ['error'] });

/**
 * Daily overdue reminder. For each active tenant:
 * - Find unpaid AR/AP due within N days (tenant.overdueAlertDays)
 *   plus anything already overdue.
 * - Send a LINE push to the tenant's ADMIN + ACCOUNTING employees.
 */
export async function runOverdueReminder(now: Date = new Date()): Promise<void> {
  const tenants = await db.tenant.findMany({ where: { isActive: true } });

  for (const tenant of tenants) {
    if (!tenant.lineAccessToken) continue;

    const settings = getTenantSettings(tenant.settings);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + settings.overdueAlertDays);

    const [receivables, payables, recipients] = await Promise.all([
      db.accountReceivable.findMany({
        where: { tenantId: tenant.id, isPaid: false, dueDate: { lte: horizon } },
        include: { customer: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      db.accountPayable.findMany({
        where: { tenantId: tenant.id, isPaid: false, dueDate: { lte: horizon } },
        include: { supplier: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      db.employee.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true,
          role: { in: ['ADMIN', 'ACCOUNTING'] },
          lineUserId: { not: null },
        },
        select: { lineUserId: true },
      }),
    ]);

    if (receivables.length === 0 && payables.length === 0) continue;
    if (recipients.length === 0) continue;

    const lines: string[] = [`📢 ${tenant.companyName} 每日帳務提醒`];
    if (receivables.length > 0) {
      lines.push('', '🟦 應收（即將到期 / 逾期）：');
      for (const r of receivables.slice(0, 10)) {
        lines.push(formatRow(r.customer.name, r.amount.toString(), r.dueDate, now));
      }
      if (receivables.length > 10) lines.push(`...還有 ${receivables.length - 10} 筆`);
    }
    if (payables.length > 0) {
      lines.push('', '🟥 應付（即將到期 / 逾期）：');
      for (const p of payables.slice(0, 10)) {
        lines.push(formatRow(p.supplier.name, p.amount.toString(), p.dueDate, now));
      }
      if (payables.length > 10) lines.push(`...還有 ${payables.length - 10} 筆`);
    }

    const text = lines.join('\n');
    const client = getLineClient(tenant.lineAccessToken);
    const userIds = recipients
      .map((r) => r.lineUserId)
      .filter((u): u is string => Boolean(u));

    try {
      await client.multicast({
        to: userIds,
        messages: [{ type: 'text', text }],
      });
      logger.info('Overdue reminder sent', { tenantId: tenant.id, recipients: userIds.length });
    } catch (err) {
      logger.error('Overdue reminder failed', { tenantId: tenant.id, error: err });
    }
  }
}

function formatRow(name: string, amount: string, dueDate: Date, now: Date): string {
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const status = diffDays < 0 ? `逾期 ${Math.abs(diffDays)} 天` : `剩 ${diffDays} 天`;
  return `• ${name} $${Number(amount).toLocaleString('zh-TW')} (${status})`;
}

/**
 * Schedule the reminder at 09:00 Asia/Taipei every day.
 */
export function scheduleOverdueReminder(): void {
  cron.schedule('0 9 * * *', () => {
    runOverdueReminder().catch((err) => {
      logger.error('Overdue reminder crashed', { error: err });
    });
  }, { timezone: 'Asia/Taipei' });
  logger.info('Overdue reminder scheduled: daily 09:00 Asia/Taipei');
}
