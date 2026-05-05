/**
 * 一次性檢查工具：列出所有 tenant 的「PDF 顯示用公司名」與系統登記的差異。
 *
 * companyHeader 解析順序：
 *   settings.companyHeader  →  tenant.companyName  → ''
 *
 * 用途：使用者懷疑 PDF 上的公司名與後台「公司資料」不一致時跑此工具排查。
 *
 * 執行：npx tsx src/tools/check-company-name.ts
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';
import { getTenantSettings } from '../shared/utils.js';

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true, isActive: true,
      companyName: true, taxId: true, address: true,
      settings: true,
    },
    orderBy: { companyName: 'asc' },
  });
  console.log(`共 ${tenants.length} 個 tenant：\n`);
  for (const t of tenants) {
    const s = getTenantSettings(t.settings);
    const headerOverride = s.companyHeader || null;
    const effective = headerOverride || t.companyName;
    const mismatch = headerOverride && headerOverride !== t.companyName;
    console.log(`▼ tenant ${t.id.slice(0, 8)}…  isActive=${t.isActive}`);
    console.log(`  Tenant.companyName             : ${JSON.stringify(t.companyName)}`);
    console.log(`  Tenant.taxId                   : ${JSON.stringify(t.taxId)}`);
    console.log(`  Tenant.address                 : ${JSON.stringify(t.address)}`);
    console.log(`  settings.companyHeader (覆蓋)  : ${JSON.stringify(headerOverride)}`);
    console.log(`  → PDF 實際顯示                  : ${JSON.stringify(effective)}`);
    if (mismatch) {
      console.log(`  ⚠ 差異：companyHeader 與 companyName 不同`);
    }
    console.log(`  settings.einvoice.sellerName   : ${JSON.stringify(s.einvoice.sellerName || null)}`);
    console.log(`  settings.einvoice.sellerTaxId  : ${JSON.stringify(s.einvoice.sellerTaxId || null)}`);
    console.log(`  settings.einvoice.sellerAddress: ${JSON.stringify(s.einvoice.sellerAddress || null)}`);
    console.log('');
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
