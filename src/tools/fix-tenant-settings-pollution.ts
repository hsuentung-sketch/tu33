/**
 * 一次性修復：清掉 settings.companyHeader 與 settings.einvoice.seller* 的污染資料。
 *
 * 背景：v2.7.4 之前 PDF 抬頭與電子發票賣方資訊允許 settings 覆蓋 Tenant.*。
 * 使用者可能在 UI 把這幾個欄位填錯（例如填成客戶資料），造成 PDF 顯示錯誤
 * 或電子發票 XML 上傳被退件。v2.7.4 起後端一律以 Tenant.* 為準，本工具一次
 * 把舊資料清空，避免後續 Phase B 程式邏輯被舊欄位干擾。
 *
 * 執行：
 *   npx tsx src/tools/fix-tenant-settings-pollution.ts          # dry-run，列差異
 *   npx tsx src/tools/fix-tenant-settings-pollution.ts --apply  # 實際清除
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';

interface PolluteRecord {
  id: string;
  companyName: string;
  drops: string[];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tenants = await prisma.tenant.findMany();
  const polluted: PolluteRecord[] = [];

  for (const t of tenants) {
    const raw = (typeof t.settings === 'object' && t.settings !== null)
      ? { ...(t.settings as Record<string, unknown>) }
      : {};
    const drops: string[] = [];
    if ('companyHeader' in raw && raw.companyHeader) {
      drops.push(`companyHeader=${JSON.stringify(raw.companyHeader)}`);
    }
    const einvoice = (raw.einvoice && typeof raw.einvoice === 'object')
      ? { ...(raw.einvoice as Record<string, unknown>) }
      : null;
    if (einvoice) {
      for (const k of ['sellerTaxId', 'sellerName', 'sellerAddress'] as const) {
        if (einvoice[k]) drops.push(`einvoice.${k}=${JSON.stringify(einvoice[k])}`);
      }
    }
    if (!drops.length) continue;

    polluted.push({ id: t.id, companyName: t.companyName, drops });

    if (apply) {
      // 移除 companyHeader
      delete raw.companyHeader;
      // 清空 einvoice 賣方欄位（保留 key，設空字串，給前端讀回時不會報錯）
      if (einvoice) {
        einvoice.sellerTaxId = '';
        einvoice.sellerName = '';
        einvoice.sellerAddress = '';
        raw.einvoice = einvoice;
      }
      await prisma.tenant.update({
        where: { id: t.id },
        data: { settings: raw as unknown as object },
      });
    }
  }

  if (!polluted.length) {
    console.log('無污染資料，所有 tenant 都乾淨。');
  } else {
    console.log(`${apply ? '已清除' : '預計清除'} ${polluted.length} 個 tenant 的污染欄位：\n`);
    for (const p of polluted) {
      console.log(`▼ ${p.companyName} (${p.id.slice(0, 8)}…)`);
      for (const d of p.drops) console.log(`  - ${d}`);
    }
    if (!apply) {
      console.log('\n（dry-run）若確認要套用，加 --apply 重跑');
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
