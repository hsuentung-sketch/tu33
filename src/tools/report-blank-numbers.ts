/**
 * 空白未使用字軌月報工具。
 *
 * 依財政部規範，每期（雙月）結束後 10 日內需將未使用之發票字軌號碼
 * 以 C0701 格式上傳整合服務平台。本工具掃描 EinvoiceNumberPool 中所有
 * nextNumber < rangeEnd 的區間，產生 C0701 XML 寫入 turnkey inbound 目錄。
 *
 * 用法：
 *   npx tsx src/tools/report-blank-numbers.ts            # 掃全部租戶
 *   npx tsx src/tools/report-blank-numbers.ts <tenantId> # 單一租戶
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';
import { getTenantSettings } from '../shared/utils.js';
import { buildC0701 } from '../modules/accounting/einvoice/xml-builder.js';
import { writeIssueXml } from '../modules/accounting/einvoice/turnkey-writer.js';

async function runTenant(tenantId: string): Promise<{ wrote: number; skipped: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  const cfg = getTenantSettings(tenant.settings).einvoice;
  if (!cfg.enabled || !cfg.turnkeyInboundDir) {
    return { wrote: 0, skipped: 1 };
  }
  const sellerTaxId = cfg.sellerTaxId || tenant.taxId || '';
  const sellerName = cfg.sellerName || tenant.companyName;

  const pools = await prisma.einvoiceNumberPool.findMany({ where: { tenantId } });
  let wrote = 0;
  for (const p of pools) {
    if (p.nextNumber > p.rangeEnd) continue;
    const xml = buildC0701({
      seller: { identifier: sellerTaxId, name: sellerName },
      yearMonth: p.yearMonth,
      trackAlpha: p.trackAlpha,
      startNumber: String(p.nextNumber).padStart(8, '0'),
      endNumber: String(p.rangeEnd).padStart(8, '0'),
      reason: '2',
    });
    const fakeNo = `BLANK_${p.trackAlpha}_${p.yearMonth}`;
    await writeIssueXml({ inboundDir: cfg.turnkeyInboundDir, invoiceNo: fakeNo, xml });
    wrote++;
  }
  return { wrote, skipped: 0 };
}

async function main() {
  const target = process.argv[2];
  if (target) {
    const r = await runTenant(target);
    console.log(`[${target}] wrote=${r.wrote} skipped=${r.skipped}`);
    return;
  }
  const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
  for (const t of tenants) {
    try {
      const r = await runTenant(t.id);
      console.log(`[${t.id}] wrote=${r.wrote} skipped=${r.skipped}`);
    } catch (e) {
      console.error(`[${t.id}] error:`, (e as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
