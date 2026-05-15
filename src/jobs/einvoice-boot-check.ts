/**
 * 服務啟動時的電子發票自我檢測。
 *
 * 依財政部「自行檢測表」項 3：開機檢核（對時 / 賣方統編 / 字軌 / 前次開立發票號碼）。
 *
 * 實作範圍：
 *  - 對時（v2.11.0+）：用 RFC 5905 UDP NTP 對 `time.stdtime.gov.tw`（國家時間
 *    與頻率標準實驗室）→ tw.pool.ntp.org → pool.ntp.org，全失敗 fallback HTTPS
 *    worldtimeapi.org。容器在 UTC 跑，Node 內 Date 是 UTC milliseconds，差值
 *    不應超過 ±5 秒（NTP 寬限）。超過 60 秒 → error log；超過 5 秒 → warn。
 *  - 賣方統編：每個 enabled tenant 必須有 8 碼數字 sellerTaxId（taxId 或 settings.einvoice.sellerTaxId）
 *  - 配號：每個 enabled tenant 必須至少有一筆 active pool；且當期（now 的 yearMonth）有可用配號
 *  - 前次開立發票號碼：DB 最後一筆 invoiceNo 必須 < pool.nextNumber（nextNumber 表「下一個要用」的號）
 *
 * 任何缺漏只 log，不阻擋服務啟動（讓 ADMIN 仍可進後台補設定）。
 */
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { getTenantSettings } from '../shared/utils.js';
import { getClockSkew } from '../shared/ntp.js';
import { periodOfDate } from '../modules/accounting/einvoice/einvoice.service.js';

interface TenantBootIssue {
  tenantId: string;
  tenantName: string;
  issues: string[];
}

async function checkTenants(now: Date): Promise<TenantBootIssue[]> {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, companyName: true, taxId: true, settings: true },
  });
  const wantedPeriod = periodOfDate(now);
  const out: TenantBootIssue[] = [];

  for (const t of tenants) {
    const cfg = getTenantSettings(t.settings).einvoice;
    if (!cfg.enabled) continue;
    const issues: string[] = [];
    const sellerTaxId = cfg.sellerTaxId || t.taxId || '';
    if (!/^\d{8}$/.test(sellerTaxId)) issues.push(`賣方統編格式錯誤：${sellerTaxId || '(空)'}`);
    if (process.env.NODE_ENV === 'production' && !/^[0-9a-fA-F]{32}$/.test(cfg.qrAesKey || '')) {
      issues.push('QR AES 金鑰未設定或格式錯誤（settings.einvoice.qrAesKey）');
    }
    if (!cfg.turnkeyInboundDir) issues.push('未設定 Turnkey 匯入目錄');

    const pools = await prisma.einvoiceNumberPool.findMany({ where: { tenantId: t.id } });
    if (pools.length === 0) {
      issues.push('未設定任何配號區間');
    } else {
      const activeCurrent = pools.filter(
        (p) => p.isActive && p.yearMonth === wantedPeriod && p.nextNumber <= p.rangeEnd,
      );
      if (activeCurrent.length === 0) {
        issues.push(`當期 ${wantedPeriod} 無可用配號`);
      }
      // 前次開立發票號碼比對
      const last = await prisma.einvoice.findFirst({
        where: { tenantId: t.id },
        orderBy: { createdAt: 'desc' },
        select: { invoiceNo: true, status: true },
      });
      if (last) {
        const lastTrack = last.invoiceNo.slice(0, 2);
        const lastNum = Number(last.invoiceNo.slice(2));
        const matchPool = pools.find((p) => p.trackAlpha === lastTrack && lastNum >= p.rangeStart && lastNum <= p.rangeEnd);
        if (matchPool && lastNum >= matchPool.nextNumber) {
          issues.push(`前次發票號碼 ${last.invoiceNo} 大於 pool.nextNumber=${matchPool.nextNumber}（資料不一致）`);
        }
      }
    }

    if (issues.length) out.push({ tenantId: t.id, tenantName: t.companyName, issues });
  }
  return out;
}

export async function runEinvoiceBootCheck(): Promise<void> {
  try {
    const now = new Date();
    const skew = await getClockSkew();
    if (skew.skewMs == null) {
      logger.warn('einvoice boot: 對時失敗（所有 NTP server + HTTP fallback 都不可達），略過時鐘檢查');
    } else {
      const abs = Math.abs(skew.skewMs);
      if (abs > 60_000) {
        logger.error('einvoice boot: 時鐘偏移過大', { skewMs: skew.skewMs, source: skew.source });
      } else if (abs > 5_000) {
        logger.warn('einvoice boot: 時鐘偏移 > 5 秒', { skewMs: skew.skewMs, source: skew.source });
      } else {
        logger.info('einvoice boot: 時鐘 OK', { skewMs: skew.skewMs, source: skew.source });
      }
    }

    const issues = await checkTenants(now);
    if (issues.length === 0) {
      logger.info('einvoice boot: 所有 enabled tenant 自我檢測通過');
    } else {
      for (const item of issues) {
        logger.warn('einvoice boot: tenant 設定缺漏', item);
      }
    }
  } catch (err) {
    logger.error('einvoice boot: 自我檢測失敗', { err });
  }
}
