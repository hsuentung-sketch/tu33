/**
 * 電子發票每日同步 + 對帳 cron（Phase D）。
 *
 * 每天台北時間 03:30 跑一次（避開 backup 03:00 與 pettyCash 02:30）：
 *  1. 對每個啟用 einvoice 的 tenant 跑 turnkey-reader.syncTenant() —— 掃 outbound
 *     目錄拉回執，更新 status (issued → confirmed / rejected)
 *  2. 漏傳補傳：找 status='issued' 且 createdAt < now-24h 的發票，重新寫入
 *     turnkey inbound dir（以 _retry 後綴）
 *  3. 對帳報表 + LINE 告警：呼叫 reconcile.reconcileAllTenants()
 *     - 漏上傳 stuck > 24h
 *     - Turnkey 拒絕（status=rejected）
 *     - 重號檢測
 *     - 字軌即將耗盡
 *     以上任一有異常 → LINE 通知 ADMIN + ACCOUNTING
 *
 * 依「電子發票 Turnkey 上線前自行檢測作業 V4.8」前置作業檢測項次 1-4 要求。
 *
 * 失敗任一 tenant / 任一張不中斷整批；錯誤累積寫 logger。
 */
import cron from 'node-cron';
import { promises as fs } from 'node:fs';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { getTenantSettings } from '../shared/utils.js';
import { syncAllTenants } from '../modules/accounting/einvoice/turnkey-reader.js';
import { buildStorageEnv, putXml } from '../modules/accounting/einvoice/turnkey-storage.js';
import { reconcileAllTenants, hasAlerts } from '../modules/accounting/einvoice/reconcile.js';

interface RetryResult {
  tenantId: string;
  retried: number;
  errors: number;
}

async function retryUnconfirmed(now: Date = new Date()): Promise<RetryResult[]> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, settings: true },
  });
  const out: RetryResult[] = [];
  for (const t of tenants) {
    const result: RetryResult = { tenantId: t.id, retried: 0, errors: 0 };
    const cfg = getTenantSettings(t.settings).einvoice;
    if (!cfg.enabled || !cfg.turnkeyInboundDir) {
      out.push(result);
      continue;
    }
    const env = buildStorageEnv({
      turnkeyBackend: cfg.turnkeyBackend,
      turnkeyInboundDir: cfg.turnkeyInboundDir,
      turnkeyOutboundDir: cfg.turnkeyOutboundDir,
    });
    const stuck = await prisma.einvoice.findMany({
      where: {
        tenantId: t.id,
        status: 'issued',
        createdAt: { lt: cutoff },
      },
      select: { id: true, invoiceNo: true, xmlPath: true, xmlBody: true },
    });
    for (const inv of stuck) {
      try {
        // 優先用 DB 內 xmlBody；fallback 從 xmlPath 讀檔（local backend）
        let xml: string | null = inv.xmlBody ?? null;
        if (!xml && inv.xmlPath) {
          xml = await fs.readFile(inv.xmlPath, 'utf8').catch(() => null);
        }
        if (!xml) { result.errors++; continue; }
        const wrote = await putXml(env, 'F0401', `${inv.invoiceNo}_retry`, xml);
        result.retried++;
        logger.info('einvoice retry: re-wrote XML', {
          tenantId: t.id, invoiceNo: inv.invoiceNo, locator: wrote.locator,
        });
      } catch (err) {
        result.errors++;
        logger.warn('einvoice retry: failed', { tenantId: t.id, invoiceNo: inv.invoiceNo, err });
      }
    }
    out.push(result);
  }
  return out;
}

export async function runEinvoiceSync(now: Date = new Date()): Promise<void> {
  try {
    const syncResults = await syncAllTenants();
    const totalUpdated = syncResults.reduce((s, r) => s + r.updated, 0);
    const retryResults = await retryUnconfirmed(now);
    const totalRetried = retryResults.reduce((s, r) => s + r.retried, 0);

    // 對帳 + 告警（Phase D）
    const reconcileReports = await reconcileAllTenants(now);
    const alertingTenants = reconcileReports.filter(hasAlerts).length;

    logger.info('einvoice sync done', {
      tenants: syncResults.length,
      confirmedUpdated: totalUpdated,
      retried: totalRetried,
      reconcileTenants: reconcileReports.length,
      alertingTenants,
    });
  } catch (err) {
    logger.error('einvoice sync failed', { err });
  }
}

export function scheduleEinvoiceSync(): void {
  // 每日台北時間 03:30 執行（避開 backup 03:00 與 pettyCash 02:30）
  cron.schedule('30 3 * * *', () => { void runEinvoiceSync(); }, { timezone: 'Asia/Taipei' });
  logger.info('einvoice sync scheduled (03:30 Asia/Taipei daily)');
}
