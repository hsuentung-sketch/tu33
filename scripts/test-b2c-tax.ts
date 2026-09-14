// Quick sanity check for B2C tax-inclusive computeTaxBreakdown
// Run: node scripts/test-b2c-tax.mjs
import { computeTaxBreakdown } from '../src/modules/accounting/einvoice/xml-builder.js';

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    console.log('   want:', want);
    console.log('   got: ', got);
  }
  return ok;
}

let pass = 0, fail = 0;
const cases = [
  {
    label: 'B2C 應稅 100 → Sales=105, Tax=0, Total=105',
    items: [{ amount: 100, taxType: '1' }],
    buyerTaxId: null,
    want: { salesAmount: 105, freeTaxSalesAmount: 0, zeroTaxSalesAmount: 0, taxAmount: 0, totalAmount: 105, overallTaxType: '1' },
  },
  {
    label: 'B2C 應稅 100 (buyerTaxId="") → same',
    items: [{ amount: 100, taxType: '1' }],
    buyerTaxId: '',
    want: { salesAmount: 105, freeTaxSalesAmount: 0, zeroTaxSalesAmount: 0, taxAmount: 0, totalAmount: 105, overallTaxType: '1' },
  },
  {
    label: 'B2B 應稅 100 → Sales=100, Tax=5, Total=105',
    items: [{ amount: 100, taxType: '1' }],
    buyerTaxId: '12345678',
    want: { salesAmount: 100, freeTaxSalesAmount: 0, zeroTaxSalesAmount: 0, taxAmount: 5, totalAmount: 105, overallTaxType: '1' },
  },
  {
    label: 'B2B 零稅 100 → Zero=100, Tax=0',
    items: [{ amount: 100, taxType: '2' }],
    buyerTaxId: '12345678',
    want: { salesAmount: 0, freeTaxSalesAmount: 0, zeroTaxSalesAmount: 100, taxAmount: 0, totalAmount: 100, overallTaxType: '2' },
  },
  {
    label: 'B2B 免稅 100 → Free=100, Tax=0',
    items: [{ amount: 100, taxType: '3' }],
    buyerTaxId: '12345678',
    want: { salesAmount: 0, freeTaxSalesAmount: 100, zeroTaxSalesAmount: 0, taxAmount: 0, totalAmount: 100, overallTaxType: '3' },
  },
  {
    label: 'B2C 混稅 應100+免200 → Sales=105, Free=200, Tax=0, Total=305, overall=9',
    items: [{ amount: 100, taxType: '1' }, { amount: 200, taxType: '3' }],
    buyerTaxId: null,
    want: { salesAmount: 105, freeTaxSalesAmount: 200, zeroTaxSalesAmount: 0, taxAmount: 0, totalAmount: 305, overallTaxType: '9' },
  },
  {
    label: 'B2B 混稅 應100+免200 → Sales=100, Free=200, Tax=5, Total=305, overall=9',
    items: [{ amount: 100, taxType: '1' }, { amount: 200, taxType: '3' }],
    buyerTaxId: '12345678',
    want: { salesAmount: 100, freeTaxSalesAmount: 200, zeroTaxSalesAmount: 0, taxAmount: 5, totalAmount: 305, overallTaxType: '9' },
  },
];

for (const c of cases) {
  const got = computeTaxBreakdown(c.items, 0.05, '1', c.buyerTaxId);
  if (check(c.label, got, c.want)) pass++; else fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
