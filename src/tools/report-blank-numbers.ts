/**
 * 空白未使用字軌月報 CLI（MIG 4.1 E0402）。
 *
 * Phase E 後：本 CLI 是 cron job `einvoice-blank-report.ts` 的手動觸發器，
 * 邏輯移到 `src/modules/accounting/einvoice/blank-report.service.ts`。
 *
 * 用法：
 *   npx tsx src/tools/report-blank-numbers.ts                       # 掃全部租戶，用當期
 *   npx tsx src/tools/report-blank-numbers.ts <tenantId>            # 單一租戶
 *   npx tsx src/tools/report-blank-numbers.ts <tenantId> <yearMonth># 指定期別，例 "1131112"
 */
import 'dotenv/config';
import {
  currentReportPeriod,
  reportTenantBlankNumbers,
  reportAllTenantsBlankNumbers,
} from '../modules/accounting/einvoice/blank-report.service.js';

async function main() {
  const tenantArg = process.argv[2];
  const yearMonthArg = process.argv[3];
  const period = yearMonthArg ?? currentReportPeriod();

  if (tenantArg) {
    const r = await reportTenantBlankNumbers(tenantArg, period, 'cli');
    console.log(`[${r.companyName}] period=${r.yearMonth} reported=${r.reported} skipped=${r.skipped} errors=${r.errors}`);
    return;
  }

  const results = await reportAllTenantsBlankNumbers(period);
  for (const r of results) {
    console.log(`[${r.companyName}] period=${r.yearMonth} reported=${r.reported} skipped=${r.skipped} errors=${r.errors}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
