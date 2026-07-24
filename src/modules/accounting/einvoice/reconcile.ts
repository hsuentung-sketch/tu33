/**
 * 電子發票對帳與告警（Phase D）
 *
 * 依「電子發票 Turnkey 上線前自行檢測作業 V4.8」前置作業檢測要求：
 *  - 項次 3 漏上傳檢核：每日比對開立筆數 vs 上傳筆數
 *  - 項次 4 發票異常處理：每日處理 Turnkey 錯誤訊息 + SummaryResult 對帳
 *  - 項次 2 重號檢核：跨店重號告警
 *  - 項次 1 字軌檢核：字軌即將耗盡告警
 *
 * 使用方式：由 `src/jobs/einvoice-sync.ts` 每日 cron 呼叫 reconcileAllTenants()。
 * 有異常 → 透過 LINE 通知 ADMIN + ACCOUNTING 員工。
 */

import { prisma } from '../../../shared/prisma.js';
import { logger } from '../../../shared/logger.js';
import { getLineClient } from '../../../line/client.js';
import { getTenantSettings } from '../../../shared/utils.js';

export interface ReconcileReport {
  tenantId: string;
  companyName: string;
  /** 24 小時內開立筆數 */
  issued24h: number;
  /** 已收到平台成功回覆 */
  confirmed: number;
  /** 平台已回覆但拒絕 */
  rejected: number;
  /** 開立 > 24hr 仍未確認（漏上傳或未收到回覆） */
  stuck: Array<{ invoiceNo: string; ageHours: number }>;
  /** 重號（同一租戶內兩張以上相同號碼；理論上 unique constraint 會擋，但保險起見） */
  duplicates: Array<{ invoiceNo: string; count: number }>;
  /** 字軌池即將耗盡（剩餘 < 10% 或 < 50 張） */
  poolLowWarnings: Array<{
    poolId: string;
    yearMonth: string;
    trackAlpha: string;
    remaining: number;
    totalRange: number;
    percentRemaining: number;
  }>;
}

const STUCK_THRESHOLD_HOURS = 24;
const POOL_LOW_PERCENT = 0.1;
const POOL_LOW_ABSOLUTE = 50;

export async function reconcileTenant(tenantId: string, now: Date = new Date()): Promise<ReconcileReport> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const companyName = tenant?.companyName ?? tenantId;

  const dayAgo = new Date(now.getTime() - STUCK_THRESHOLD_HOURS * 60 * 60 * 1000);

  const [issued24h, confirmed, rejected, stuckInvoices, allPools] = await Promise.all([
    prisma.einvoice.count({
      where: { tenantId, createdAt: { gte: dayAgo } },
    }),
    prisma.einvoice.count({
      where: { tenantId, status: 'confirmed', createdAt: { gte: dayAgo } },
    }),
    prisma.einvoice.count({
      where: { tenantId, status: 'rejected', createdAt: { gte: dayAgo } },
    }),
    prisma.einvoice.findMany({
      where: {
        tenantId,
        status: 'issued', // 尚未收到平台回覆（confirmed/rejected/voided/nullified 都不算 stuck）
        createdAt: { lt: dayAgo },
      },
      select: { invoiceNo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.einvoiceNumberPool.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true, yearMonth: true, trackAlpha: true,
        rangeStart: true, rangeEnd: true, nextNumber: true,
      },
    }),
  ]);

  // 重號檢測（跨店）：group by invoiceNo
  const dupRaw: Array<{ invoiceNo: string; count: bigint }> = await prisma.$queryRaw`
    SELECT "invoiceNo", COUNT(*) AS count
    FROM "Einvoice"
    WHERE "tenantId" = ${tenantId}
    GROUP BY "invoiceNo"
    HAVING COUNT(*) > 1
    LIMIT 20
  `;
  const duplicates = dupRaw.map((d) => ({ invoiceNo: d.invoiceNo, count: Number(d.count) }));

  const stuck = stuckInvoices.map((s) => ({
    invoiceNo: s.invoiceNo,
    ageHours: Math.floor((now.getTime() - s.createdAt.getTime()) / (60 * 60 * 1000)),
  }));

  const poolLowWarnings = allPools
    .map((p) => {
      const totalRange = p.rangeEnd - p.rangeStart + 1;
      const remaining = Math.max(0, p.rangeEnd - p.nextNumber + 1);
      const percentRemaining = totalRange > 0 ? remaining / totalRange : 0;
      return { poolId: p.id, yearMonth: p.yearMonth, trackAlpha: p.trackAlpha, remaining, totalRange, percentRemaining };
    })
    .filter((p) => p.remaining < POOL_LOW_ABSOLUTE || p.percentRemaining < POOL_LOW_PERCENT);

  return {
    tenantId, companyName,
    issued24h, confirmed, rejected,
    stuck, duplicates, poolLowWarnings,
  };
}

/** 是否有需要通知 ADMIN 的告警 */
export function hasAlerts(report: ReconcileReport): boolean {
  return report.rejected > 0
    || report.stuck.length > 0
    || report.duplicates.length > 0
    || report.poolLowWarnings.length > 0;
}

/** 產生告警訊息文字（LINE 用） */
export function formatAlertText(report: ReconcileReport): string {
  const lines: string[] = [`⚠️ ${report.companyName} 電子發票每日對帳異常`];

  lines.push('', `📊 過去 24 小時：開立 ${report.issued24h} / 已確認 ${report.confirmed} / 拒絕 ${report.rejected}`);

  if (report.rejected > 0) {
    lines.push('', `❌ Turnkey 平台拒絕 ${report.rejected} 筆，請至後台檢視錯誤原因`);
  }

  if (report.stuck.length > 0) {
    lines.push('', `⏰ 逾 24 小時未收到平台回覆的發票（${report.stuck.length} 筆）：`);
    for (const s of report.stuck.slice(0, 10)) {
      lines.push(`• ${s.invoiceNo}（開立已 ${s.ageHours} 小時）`);
    }
    if (report.stuck.length > 10) lines.push(`...還有 ${report.stuck.length - 10} 筆`);
    lines.push('（sync job 會自動重試上傳；若持續失敗請檢查 Turnkey 連線）');
  }

  if (report.duplicates.length > 0) {
    lines.push('', `🚨 發現重號（${report.duplicates.length} 組），請立即處理：`);
    for (const d of report.duplicates) {
      lines.push(`• ${d.invoiceNo}（重複 ${d.count} 筆）`);
    }
  }

  if (report.poolLowWarnings.length > 0) {
    lines.push('', `🔔 字軌配號即將耗盡：`);
    for (const p of report.poolLowWarnings) {
      const pct = (p.percentRemaining * 100).toFixed(1);
      lines.push(`• ${p.yearMonth} ${p.trackAlpha}：剩 ${p.remaining} / ${p.totalRange}（${pct}%）`);
    }
    lines.push('（請至字軌配號頁匯入新配號）');
  }

  return lines.join('\n');
}

/** 發送 LINE 告警給 tenant 的 ADMIN + ACCOUNTING 員工 */
export async function sendReconcileAlerts(report: ReconcileReport): Promise<{ sent: boolean; recipients: number }> {
  if (!hasAlerts(report)) return { sent: false, recipients: 0 };

  const tenant = await prisma.tenant.findUnique({ where: { id: report.tenantId } });
  if (!tenant?.lineAccessToken) {
    logger.warn('einvoice reconcile: tenant 沒設 LINE token，僅寫 log', { tenantId: report.tenantId });
    return { sent: false, recipients: 0 };
  }

  const recipients = await prisma.employee.findMany({
    where: {
      tenantId: report.tenantId,
      isActive: true,
      role: { in: ['ADMIN', 'ACCOUNTING'] },
      lineUserId: { not: null },
    },
    select: { lineUserId: true },
  });
  const userIds = recipients.map((r) => r.lineUserId).filter((u): u is string => Boolean(u));
  if (userIds.length === 0) {
    logger.warn('einvoice reconcile: 無 ADMIN/ACCOUNTING 已綁定 LINE，僅寫 log', { tenantId: report.tenantId });
    return { sent: false, recipients: 0 };
  }

  const text = formatAlertText(report);
  const client = getLineClient(tenant.lineAccessToken);
  try {
    await client.multicast({ to: userIds, messages: [{ type: 'text', text }] });
    logger.info('einvoice reconcile: 已通知 ADMIN', { tenantId: report.tenantId, recipients: userIds.length });
    return { sent: true, recipients: userIds.length };
  } catch (err) {
    logger.error('einvoice reconcile: LINE 通知失敗', { tenantId: report.tenantId, err });
    return { sent: false, recipients: 0 };
  }
}

/** 批次對帳全部啟用電子發票的租戶 */
export async function reconcileAllTenants(now: Date = new Date()): Promise<ReconcileReport[]> {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, settings: true },
  });
  const reports: ReconcileReport[] = [];
  for (const t of tenants) {
    const cfg = getTenantSettings(t.settings).einvoice;
    if (!cfg.enabled) continue;
    try {
      const report = await reconcileTenant(t.id, now);
      reports.push(report);
      await sendReconcileAlerts(report);
    } catch (err) {
      logger.error('einvoice reconcile: tenant failed', { tenantId: t.id, err });
    }
  }
  return reports;
}
