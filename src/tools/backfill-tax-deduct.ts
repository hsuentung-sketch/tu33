/**
 * 一次性回填：為現有 JournalEntry 補上稅務扣抵欄位。
 *
 * 使用：
 *   npx tsx src/tools/backfill-tax-deduct.ts          # dry-run（只印不寫）
 *   npx tsx src/tools/backfill-tax-deduct.ts --execute # 寫入 DB
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { TAX_RULES, calcTaxDeduction } from '../modules/accounting/expense/expense.service.js';
const execute = process.argv.includes('--execute');

async function main() {
  const entries = await prisma.journalEntry.findMany({
    where: {
      vatDeductType: null,
      source: { in: ['expense', 'purchase'] },
    },
    include: {
      lines: {
        include: { account: { select: { code: true, type: true } } },
      },
    },
    orderBy: { entryDate: 'asc' },
  });

  console.log(`Found ${entries.length} entries to backfill (execute=${execute})\n`);

  let updated = 0;
  let skipped = 0;

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
      const rule = TAX_RULES[code];
      if (!rule) {
        console.log(`  SKIP ${e.entryNo} — no TAX_RULE for code ${code}`);
        skipped++;
        continue;
      }
      const calc = calcTaxDeduction(amount, rule);
      data = {
        vatDeductType: calc.vatDeductType,
        vatInputAmount: new Prisma.Decimal(calc.vatInputAmount),
        deductibleVat: new Prisma.Decimal(calc.deductibleVat),
        withholdingTax: new Prisma.Decimal(calc.withholdingTax),
      };
      console.log(`  ${e.entryNo} [expense] code=${code} amount=${amount} → ${calc.vatDeductType} vat=${calc.vatInputAmount} deduct=${calc.deductibleVat} wht=${calc.withholdingTax}`);
    } else if (e.source === 'purchase') {
      const taxLine = e.lines.find(l => l.account.code === '2132');
      const tax = taxLine ? Number(taxLine.debit) : 0;
      if (tax > 0) {
        data = {
          vatDeductType: 'deductible',
          vatInputAmount: new Prisma.Decimal(tax),
          deductibleVat: new Prisma.Decimal(tax),
          withholdingTax: new Prisma.Decimal(0),
        };
        console.log(`  ${e.entryNo} [purchase] tax=${tax} → deductible`);
      } else {
        data = {
          vatDeductType: 'non_deductible',
          vatInputAmount: new Prisma.Decimal(0),
          deductibleVat: new Prisma.Decimal(0),
          withholdingTax: new Prisma.Decimal(0),
        };
        console.log(`  ${e.entryNo} [purchase] no tax line → non_deductible`);
      }
    }

    if (data && execute) {
      await prisma.journalEntry.update({ where: { id: e.id }, data });
      updated++;
    } else if (data) {
      updated++;
    }
  }

  console.log(`\nDone: ${updated} would update, ${skipped} skipped`);
  if (!execute && updated > 0) {
    console.log('Run with --execute to apply changes.');
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
