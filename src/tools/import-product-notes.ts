/**
 * Import EK 系列產品「產品特點與摘要 + 對應產品」到 Product.note。
 *
 * 資料來源：D:\\Claude\\ERP\\public\\admin\\EK產品說明.pdf（v2.9.0 隨附）
 *
 * Usage:
 *   npx tsx src/tools/import-product-notes.ts <tenantId> [--confirm] [--dry-run]
 *
 * 預設 dry-run（只報告會改什麼）。加 --confirm 才實際 UPDATE。
 *
 * 對應規則：PDF 代號 `SS-6280` → DB code `EK-SS-6280`（前綴 EK-）
 * 寫入規則：覆蓋既有 note（user 決定 a/a/a/a 中第 4 題選「覆蓋既有 note」）
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';

interface ProductNoteEntry {
  /** PDF 上印的代號 */
  pdfCode: string;
  /** DB 上實際 Product.code，預設 = `EK-${pdfCode}` 但容許覆寫 */
  dbCode?: string;
  /** 產品特點與摘要欄文字 */
  description: string;
  /** 對應產品（國外牌號），無則為 null */
  brandEquivalent: string | null;
}

const ENTRIES: ProductNoteEntry[] = [
  {
    pdfCode: 'SS-6280',
    description: '適用於各種材質之加工，潤滑極壓均佳。',
    brandEquivalent: 'MORESCO BS-6S',
  },
  {
    pdfCode: 'EW-5268',
    description: '泛用型之油劑產品，適用於鐵及非鐵金屬之一般加工。',
    brandEquivalent: null,
  },
  {
    pdfCode: 'SS-6336',
    description: '一般泛用型之產品，適合各種材質之切削研磨。',
    brandEquivalent: null,
  },
  {
    pdfCode: 'EW-5206',
    description: '泛用型之油劑、潤滑、極壓、抗腐敗性均佳。',
    brandEquivalent: null,
  },
  {
    pdfCode: 'EW-5202',
    description: '含氯系極壓劑，潤滑、極壓、耐腐敗性佳，適用於嚴苛之切削。',
    brandEquivalent: 'Blaser 4000',
  },
  {
    pdfCode: 'EW-5209',
    description: '在 EW-5206 中提高潤滑劑劑量，適用於要求較高的表面光澤度及延長刀具壽命。',
    brandEquivalent: 'Blaser 2000',
  },
  {
    pdfCode: 'SYN-7052',
    description: '極佳的排油性、低泡性、長壽命，提供優異的防鏽與抗菌性，提升加工精度、保護工件與機器。',
    brandEquivalent: 'Castrol 9930C',
  },
  {
    pdfCode: 'SYN-7720',
    description: '極佳的刀具壽命以及表面精密度，很好的工件可見度極不易起泡。',
    brandEquivalent: 'CImcool 3200VLZ',
  },
  {
    pdfCode: 'SS-6368',
    description: '銅及鋁合金專用油劑，適合長時間的加工，優異的抗腐蝕性及清潔性。',
    brandEquivalent: '福斯 7630',
  },
  {
    pdfCode: 'EW-5369',
    description: '銅及鋁合金專用油劑，適用大型工件長時間加工，提供超強抗腐蝕性能及保護表面光澤度。',
    brandEquivalent: null,
  },
  {
    pdfCode: 'C-215',
    description: '鋼材之切削、鑽孔、銑削適合複合車床、多刀車床、CNC、MC 之應用。',
    brandEquivalent: 'ENEOS RELIACUT DH10',
  },
  {
    pdfCode: 'AE-68',
    description: '抗乳化多用途滑道油。',
    brandEquivalent: null,
  },
  {
    pdfCode: 'X-324M',
    description: '溶劑型防鏽，鹽霧試驗 12 小時，防鏽期 3-6 個月。',
    brandEquivalent: null,
  },
  {
    pdfCode: 'X-324L',
    description: '溶劑型防鏽，鹽霧試驗 24 小時，防鏽期 8-12 個月。',
    brandEquivalent: null,
  },
];

function buildNote(entry: ProductNoteEntry): string {
  if (entry.brandEquivalent) {
    return `${entry.description}\n對應產品：${entry.brandEquivalent}`;
  }
  return entry.description;
}

async function main() {
  const [, , tenantId, ...flags] = process.argv;
  if (!tenantId) {
    console.error('Usage: npx tsx src/tools/import-product-notes.ts <tenantId> [--confirm]');
    process.exit(1);
  }
  const confirm = flags.includes('--confirm');
  const explicitDry = flags.includes('--dry-run');
  const isDry = !confirm || explicitDry;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  console.log(`Tenant: ${tenant.companyName} (${tenantId})`);
  console.log(`Mode: ${isDry ? 'DRY-RUN (no writes)' : 'CONFIRM (will UPDATE)'}\n`);

  let found = 0;
  let missing = 0;
  let updated = 0;
  const missingList: string[] = [];

  for (const entry of ENTRIES) {
    const expectedCode = entry.dbCode ?? `EK-${entry.pdfCode}`;
    // 嘗試 EK-{code} 為主，找不到再用 PDF code 本身
    let product = await prisma.product.findFirst({
      where: { tenantId, code: expectedCode },
    });
    if (!product) {
      product = await prisma.product.findFirst({
        where: { tenantId, code: entry.pdfCode },
      });
    }
    if (!product) {
      missing++;
      missingList.push(entry.pdfCode);
      console.log(`✗ ${entry.pdfCode}: 找不到（試 ${expectedCode}、${entry.pdfCode}）`);
      continue;
    }
    found++;
    const newNote = buildNote(entry);
    const oldNote = product.note ?? '';
    if (oldNote === newNote) {
      console.log(`= ${product.code}: 已是最新，跳過`);
      continue;
    }
    if (isDry) {
      console.log(`→ ${product.code}: 將更新 note`);
      console.log(`    舊：${oldNote.slice(0, 80) || '(空)'}`);
      console.log(`    新：${newNote.slice(0, 80)}`);
    } else {
      await prisma.product.update({
        where: { id: product.id },
        data: { note: newNote },
      });
      updated++;
      console.log(`✓ ${product.code}: 已更新`);
    }
  }

  console.log(`\n--- 統計 ---`);
  console.log(`找到產品：${found} / ${ENTRIES.length}`);
  console.log(`找不到：${missing}${missing > 0 ? ' (' + missingList.join(', ') + ')' : ''}`);
  if (!isDry) console.log(`實際更新：${updated}`);
  else console.log(`Dry-run，未實際寫入。加 --confirm 才執行。`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
