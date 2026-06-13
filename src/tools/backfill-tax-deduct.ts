/**
 * 回填 / 重新分析：為 JournalEntry 補上或更正稅務扣抵欄位。
 *
 * 使用：
 *   npx tsx src/tools/backfill-tax-deduct.ts          # dry-run（只印不寫）
 *   npx tsx src/tools/backfill-tax-deduct.ts --execute # 寫入 DB
 *
 * 分析邏輯（依會計師事務所規則）：
 *  1. expense → 依描述關鍵字 + 科目代碼綜合判斷（analyzeTaxDeduction）
 *  2. purchase → 有 2132 進項稅行 → deductible；無 → non_deductible
 *  3. 其他 source（sales/receipt/payment/opening/petty_cash/reversal）→ 不處理
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { analyzeTaxDeduction } from '../modules/accounting/expense/expense.service.js';

const execute = process.argv.includes('--execute');

async function main() {
  const entries = await prisma.journalEntry.findMany({
    where: {
      source: { in: ['expense', 'purchase'] },
    },
    include: {
      lines: {
        include: { account: { select: { code: true, type: true } } },
      },
    },
    orderBy: { entryDate: 'asc' },
  });

  console.log(`Found ${entries.length} entries to analyze (execute=${execute})\n`);

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const e of entries) {
    let data: Prisma.JournalEntryUpdateInput | null = null;

    if (e.source === 'expense') {
      const expenseLine = e.lines.find(l => l.account.type === 'expense');
      if (!expenseLine) {
        console.log(`  SKIP ${e.entryNo} — no expense account line`);
        skipped++;
        continue;
      }
      const code = expenseLine.account.code;
      const amount = Number(expenseLine.debit);
      const calc = analyzeTaxDeduction(code, e.description, amount);
      data = {
        vatDeductType: calc.vatDeductType,
        vatInputAmount: new Prisma.Decimal(calc.vatInputAmount),
        deductibleVat: new Prisma.Decimal(calc.deductibleVat),
        withholdingTax: new Prisma.Decimal(calc.withholdingTax),
      };

      // Check if value actually changed
      if (e.vatDeductType === calc.vatDeductType) {
        unchanged++;
        continue;
      }

      const prev = e.vatDeductType ?? 'null';
      console.log(`  ${e.entryNo} [expense] "${e.description}" code=${code} amount=${amount} → ${prev} ⇒ ${calc.vatDeductType} vat=${calc.vatInputAmount}`);
    } else if (e.source === 'purchase') {
      const taxLine = e.lines.find(l => l.account.code === '2132');
      const tax = taxLine ? Number(taxLine.debit) : 0;
      const newType = tax > 0 ? 'deductible' : 'non_deductible';

      if (e.vatDeductType === newType) {
        unchanged++;
        continue;
      }

      if (tax > 0) {
        data = {
          vatDeductType: 'deductible',
          vatInputAmount: new Prisma.Decimal(tax),
          deductibleVat: new Prisma.Decimal(tax),
          withholdingTax: new Prisma.Decimal(0),
        };
        console.log(`  ${e.entryNo} [purchase] "${e.description}" tax=${tax} → deductible`);
      } else {
        data = {
          vatDeductType: 'non_deductible',
          vatInputAmount: new Prisma.Decimal(0),
          deductibleVat: new Prisma.Decimal(0),
          withholdingTax: new Prisma.Decimal(0),
        };
        console.log(`  ${e.entryNo} [purchase] "${e.description}" no tax line → non_deductible`);
      }
    }

    if (data && execute) {
      await prisma.journalEntry.update({ where: { id: e.id }, data });
      updated++;
    } else if (data) {
      updated++;
    }
  }

  console.log(`\nDone: ${updated} would update, ${unchanged} unchanged, ${skipped} skipped`);
  if (!execute && updated > 0) {
    console.log('Run with --execute to apply changes.');
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
