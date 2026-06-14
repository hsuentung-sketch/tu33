/**
 * Import products from 宗佑農機 parts Excel files (.xls).
 *
 * Structure: each sheet has multiple column-groups side by side, each group
 * repeats headers like [廠商, 廠牌/型號, 品名/規格, 數量, X/成本, P/小賣, S/修, 備註].
 * Products span across groups horizontally. 廠牌/型號 acts as a "sticky"
 * model prefix that applies to subsequent rows until the next model appears.
 *
 * Accepts multiple files — run once for 引擎零件.xls and once for 小引擎.xls,
 * or pass both paths.
 *
 * Usage:
 *   npx tsx src/tools/import-agri-products.ts <tenantId> <file1.xls> [file2.xls ...]
 */
import 'dotenv/config';
import XLSX from 'xlsx';
import { prisma as db } from '../shared/prisma.js';

interface RawProduct {
  model: string;
  name: string;
  costPrice: number;
  salePrice: number;
  sheet: string;
  file: string;
}

const PRICE_COL_NAMES = new Set(['X', 'P', 'S', '成本', '小賣', '修', '自進', '乙興', '曜薪', '忠豐', '隆德', '賣', '裝']);
const NAME_COL = '品名/規格';
const MODEL_COL = '廠牌/型號';

function detectGroups(headerRow: any[]): Array<{ nameCol: number; modelCol: number; costCol: number; saleCol: number }> {
  const groups: Array<{ nameCol: number; modelCol: number; costCol: number; saleCol: number }> = [];

  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] ?? '').trim();
    if (h === NAME_COL) {
      const modelCol = findNearby(headerRow, i, MODEL_COL, -4);
      const { costCol, saleCol } = findPriceCols(headerRow, i);
      groups.push({
        nameCol: i,
        modelCol: modelCol ?? i,
        costCol,
        saleCol,
      });
    }
  }
  return groups;
}

function findNearby(row: any[], from: number, target: string, range: number): number | null {
  const start = range < 0 ? Math.max(0, from + range) : from;
  const end = range < 0 ? from : Math.min(row.length, from + range);
  for (let i = start; i < end; i++) {
    if (String(row[i] ?? '').trim() === target) return i;
  }
  return null;
}

function findPriceCols(headerRow: any[], nameCol: number): { costCol: number; saleCol: number } {
  let costCol = -1;
  let saleCol = -1;
  for (let i = nameCol + 1; i < Math.min(nameCol + 8, headerRow.length); i++) {
    const h = String(headerRow[i] ?? '').trim();
    if (h === NAME_COL || h === MODEL_COL || h === '廠商') break;
    if (!PRICE_COL_NAMES.has(h)) continue;
    if (h === 'X' || h === '成本' || h === '自進') {
      costCol = i;
    } else if (h === 'P' || h === '小賣' || h === '賣') {
      saleCol = i;
    } else if (h === 'S' || h === '修' || h === '裝') {
      if (saleCol < 0) saleCol = i;
    }
  }
  if (costCol < 0 && saleCol >= 0) costCol = saleCol;
  if (saleCol < 0 && costCol >= 0) saleCol = costCol;
  return { costCol, saleCol };
}

function extractProducts(wb: XLSX.WorkBook, fileName: string): RawProduct[] {
  const products: RawProduct[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (rows.length < 2) continue;

    const headerRow = rows[0];
    const groups = detectGroups(headerRow);
    if (groups.length === 0) continue;

    const stickyModel: string[] = new Array(groups.length).fill('');

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      for (let g = 0; g < groups.length; g++) {
        const grp = groups[g];
        const modelVal = String(row[grp.modelCol] ?? '').trim();
        if (modelVal && modelVal.length > 1 && !/^\d+$/.test(modelVal)) {
          stickyModel[g] = modelVal;
        }

        const nameVal = String(row[grp.nameCol] ?? '').trim();
        if (!nameVal || nameVal.length < 2) continue;
        if (/^(全部|以下|充電類|新機|油箱部位|引擎部位|部位)/.test(nameVal)) continue;

        const costRaw = grp.costCol >= 0 ? row[grp.costCol] : null;
        const saleRaw = grp.saleCol >= 0 ? row[grp.saleCol] : null;
        const costPrice = parsePrice(costRaw);
        const salePrice = parsePrice(saleRaw);
        if (costPrice === 0 && salePrice === 0) continue;

        products.push({
          model: stickyModel[g],
          name: nameVal,
          costPrice,
          salePrice: salePrice || costPrice,
          sheet: sheetName,
          file: fileName,
        });
      }
    }
  }

  return products;
}

function parsePrice(v: any): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function dedup(products: RawProduct[]): RawProduct[] {
  const seen = new Map<string, RawProduct>();
  for (const p of products) {
    const key = `${p.model}||${p.name}`;
    const existing = seen.get(key);
    if (!existing || p.salePrice > existing.salePrice) {
      seen.set(key, p);
    }
  }
  return [...seen.values()];
}

function generateCode(model: string, name: string, index: number): string {
  const prefix = model.replace(/[^A-Z0-9]/gi, '').slice(0, 10).toUpperCase() || 'PART';
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

async function importAgriProducts(tenantId: string, filePaths: string[]) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  let allProducts: RawProduct[] = [];

  for (const fp of filePaths) {
    console.log(`Reading: ${fp}`);
    const wb = XLSX.readFile(fp);
    const products = extractProducts(wb, fp);
    console.log(`  extracted ${products.length} raw entries from ${wb.SheetNames.length} sheets`);
    allProducts.push(...products);
  }

  const unique = dedup(allProducts);
  console.log(`\nAfter dedup: ${unique.length} unique products`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const BATCH = 100;

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    for (const p of batch) {
      const code = generateCode(p.model, p.name, i + batch.indexOf(p) + 1);
      const fullName = p.model ? `${p.model} ${p.name}` : p.name;

      const existing = await db.product.findFirst({
        where: { tenantId, name: fullName },
      });

      const data = {
        tenantId,
        code,
        name: fullName,
        category: 'PART' as const,
        salePrice: p.salePrice,
        costPrice: p.costPrice,
        note: `來源: ${p.sheet}`,
      };

      if (existing) {
        await db.product.update({
          where: { id: existing.id },
          data: { salePrice: data.salePrice, costPrice: data.costPrice },
        });
        updated++;
      } else {
        try {
          await db.product.create({ data });
          created++;
        } catch (err: any) {
          if (err.code === 'P2002') {
            skipped++;
          } else {
            throw err;
          }
        }
      }
    }
    console.log(`  progress: ${Math.min(i + BATCH, unique.length)}/${unique.length}`);
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${skipped} skipped`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx tsx src/tools/import-agri-products.ts <tenantId> <file1.xls> [file2.xls ...]');
  process.exit(1);
}

const [tenantId, ...filePaths] = args;

importAgriProducts(tenantId, filePaths)
  .catch((err) => { console.error('Import failed:', err); process.exit(1); })
  .finally(() => db.$disconnect());
