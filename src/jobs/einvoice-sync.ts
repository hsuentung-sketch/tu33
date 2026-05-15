/**
 * 電子發票每日同步 cron。
 *
 * 每天台北時間 02:30 跑一次：
 *  1. 對每個 tenant 跑 turnkey-reader.syncTenant() —— 掃 outbound 目錄拉回執，
 *     更新 status (issued → confirmed / rejected)
 *  2. 漏傳補傳：對每個 tenant 找 status='issued' 且 createdAt < now-24h 的發票，
 *     重新將 XML 寫到 turnkey inbound dir（以 _retry-<n> 為後綴）。
 *
 * 依財政部「自行檢測表」項 10：系統已具備漏傳檢核機制 + 每日重新上傳。
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
        const wrote = await putXml(env, 'C0401', `${inv.invoiceNo}_retry`, xml);
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
    logger.info('einvoice sync done', {
      tenants: syncResults.length,
      confirmedUpdated: totalUpdated,
      retried: totalRetried,
    });
  } catch (err) {
    logger.error('einvoice sync failed', { err });
  }
}

export function scheduleEinvoiceSync(): void {
  // 每日台北時間 02:30 執行
  cron.schedule('30 2 * * *', () => { void runEinvoiceSync(); }, { timezone: 'Asia/Taipei' });
  logger.info('einvoice sync scheduled (02:30 Asia/Taipei daily)');
}
