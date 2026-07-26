/**
 * 產出 5 種 MIG 4.1 sample XML 驗證 XML builder 正確性。
 *
 * 用法：npx tsx src/tools/test-xml-samples.ts [output-dir]
 *
 * 產出：
 *   F0401_taxable.xml    應稅 (TaxType=1)
 *   F0401_zerotax.xml    零稅 (TaxType=2)
 *   F0401_exempt.xml     免稅 (TaxType=3)
 *   F0401_mixed.xml      混稅 (TaxType=9)
 *   F0401_b2c_carrier.xml B2C 手機條碼載具
 *   F0401_donate.xml     捐贈
 *   F0501_void.xml       作廢
 *   F0701_nullify.xml    註銷
 *   G0401_allowance.xml  折讓
 *   G0501_void_allow.xml 作廢折讓
 *   E0402_blank.xml      空白字軌回報
 *
 * 每份 XML 開頭有 comment 標示情境；tsx 執行後可用 xmllint 驗證格式。
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildF0401, buildF0501, buildF0701, buildG0401, buildG0501, buildE0402,
  computeTaxBreakdown,
} from '../modules/accounting/einvoice/xml-builder.js';

const SELLER = {
  identifier: '62198132',
  name: '潤樋實業有限公司',
  address: '新北市中和區某某路 88 號',
  personInCharge: '許先生',
  telephoneNumber: '02-2222-3333',
  facsimileNumber: '02-2222-3334',
};

const BUYER_B2B = {
  identifier: '12345678',
  name: '某某買方股份有限公司',
  address: '台北市信義區某某路 100 號',
};

const BUYER_B2C = {
  identifier: null,
  name: '一般消費者',
};

const now = new Date();

async function main() {
  const outDir = resolve(process.argv[2] ?? './scratch/xml-samples');
  await fs.mkdir(outDir, { recursive: true });

  const samples: Record<string, string> = {};

  // 1. F0401 應稅 B2B
  {
    const items = [
      { sequence: 1, description: '5W-30 引擎油 4L', quantity: 10, unitPrice: 900, amount: 9000, taxType: '1' },
    ];
    const b = computeTaxBreakdown(items, 0.05, '1');
    samples['F0401_taxable_b2b.xml'] = buildF0401({
      invoiceNo: 'AB12345678',
      invoiceDate: now,
      seller: SELLER,
      buyer: BUYER_B2B,
      items,
      salesAmount: b.salesAmount,
      freeTaxSalesAmount: b.freeTaxSalesAmount,
      zeroTaxSalesAmount: b.zeroTaxSalesAmount,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      taxType: b.overallTaxType,
      randomCode: '1234',
      printFlag: 'Y',
    });
  }

  // 2. F0401 零稅 (外銷)
  {
    const items = [
      { sequence: 1, description: '外銷油品 200L', quantity: 1, unitPrice: 50000, amount: 50000, taxType: '2' },
    ];
    const b = computeTaxBreakdown(items, 0.05, '2');
    samples['F0401_zerotax.xml'] = buildF0401({
      invoiceNo: 'AB12345679',
      invoiceDate: now,
      seller: SELLER,
      buyer: BUYER_B2B,
      items,
      salesAmount: b.salesAmount,
      freeTaxSalesAmount: b.freeTaxSalesAmount,
      zeroTaxSalesAmount: b.zeroTaxSalesAmount,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      taxType: b.overallTaxType,
      customsClearanceMark: '2',
      zeroTaxRateReason: '外銷貨物',
      randomCode: '5678',
    });
  }

  // 3. F0401 免稅
  {
    const items = [
      { sequence: 1, description: '免稅商品', quantity: 1, unitPrice: 1000, amount: 1000, taxType: '3' },
    ];
    const b = computeTaxBreakdown(items, 0.05, '3');
    samples['F0401_exempt.xml'] = buildF0401({
      invoiceNo: 'AB12345680',
      invoiceDate: now,
      seller: SELLER,
      buyer: BUYER_B2B,
      items,
      salesAmount: b.salesAmount,
      freeTaxSalesAmount: b.freeTaxSalesAmount,
      zeroTaxSalesAmount: b.zeroTaxSalesAmount,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      taxType: b.overallTaxType,
      randomCode: '9999',
    });
  }

  // 4. F0401 混稅（應稅 + 免稅）
  {
    const items = [
      { sequence: 1, description: '應稅品', quantity: 1, unitPrice: 1000, amount: 1000, taxType: '1' },
      { sequence: 2, description: '免稅品', quantity: 1, unitPrice: 500, amount: 500, taxType: '3' },
    ];
    const b = computeTaxBreakdown(items, 0.05, '1');
    samples['F0401_mixed.xml'] = buildF0401({
      invoiceNo: 'AB12345681',
      invoiceDate: now,
      seller: SELLER,
      buyer: BUYER_B2B,
      items,
      salesAmount: b.salesAmount,
      freeTaxSalesAmount: b.freeTaxSalesAmount,
      zeroTaxSalesAmount: b.zeroTaxSalesAmount,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      taxType: b.overallTaxType,
      randomCode: '0001',
    });
  }

  // 5. F0401 B2C 手機條碼載具
  {
    const items = [
      { sequence: 1, description: '零售商品', quantity: 1, unitPrice: 500, amount: 500, taxType: '1' },
    ];
    const b = computeTaxBreakdown(items, 0.05, '1');
    samples['F0401_b2c_carrier.xml'] = buildF0401({
      invoiceNo: 'AB12345682',
      invoiceDate: now,
      seller: SELLER,
      buyer: BUYER_B2C,
      items,
      salesAmount: b.salesAmount,
      freeTaxSalesAmount: b.freeTaxSalesAmount,
      zeroTaxSalesAmount: b.zeroTaxSalesAmount,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      taxType: b.overallTaxType,
      randomCode: '2468',
      carrierType: '3J0002',
      carrierId1: '/ABC1234',
      carrierId2: '/ABC1234',
      printFlag: 'N',
    });
  }

  // 6. F0401 捐贈
  {
    const items = [
      { sequence: 1, description: '零售商品', quantity: 1, unitPrice: 300, amount: 300, taxType: '1' },
    ];
    const b = computeTaxBreakdown(items, 0.05, '1');
    samples['F0401_donate.xml'] = buildF0401({
      invoiceNo: 'AB12345683',
      invoiceDate: now,
      seller: SELLER,
      buyer: BUYER_B2C,
      items,
      salesAmount: b.salesAmount,
      freeTaxSalesAmount: b.freeTaxSalesAmount,
      zeroTaxSalesAmount: b.zeroTaxSalesAmount,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      taxType: b.overallTaxType,
      randomCode: '1357',
      npoban: '12345',
      printFlag: 'N',
    });
  }

  // 7. F0501 作廢
  samples['F0501_void.xml'] = buildF0501({
    invoiceNo: 'AB12345678',
    invoiceDate: now,
    voidDate: now,
    voidReason: '客戶要求作廢重開',
    seller: SELLER,
    buyer: BUYER_B2B,
  });

  // 8. F0701 註銷
  samples['F0701_nullify.xml'] = buildF0701({
    invoiceNo: 'AB12345679',
    invoiceDate: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), // 兩個月前
    voidDate: now,
    voidReason: '跨期修正',
    seller: SELLER,
    buyer: BUYER_B2B,
  });

  // 9. G0401 折讓
  {
    const items = [
      { sequence: 1, originalSequence: 1, description: '5W-30 引擎油 4L 折讓', quantity: 2, unitPrice: 900, amount: 1800, taxType: '1', taxAmount: 90 },
    ];
    samples['G0401_allowance.xml'] = buildG0401({
      allowanceNo: 'AL20260724001',
      allowanceDate: now,
      seller: SELLER,
      buyer: BUYER_B2B,
      originalInvoiceNo: 'AB12345678',
      originalInvoiceDate: now,
      items,
      salesAmount: 1800,
      freeTaxSalesAmount: 0,
      zeroTaxSalesAmount: 0,
      taxAmount: 90,
      totalAmount: 1890,
      allowanceType: '2',
    });
  }

  // 10. G0501 作廢折讓
  samples['G0501_void_allowance.xml'] = buildG0501({
    allowanceNo: 'AL20260724001',
    allowanceDate: now,
    voidDate: now,
    voidReason: '折讓資訊錯誤',
    seller: SELLER,
    buyer: BUYER_B2B,
    allowanceType: '2',
  });

  // 11. E0402 空白字軌回報
  samples['E0402_blank.xml'] = buildE0402({
    seller: SELLER,
    yearMonth: '1140506',
    trackAlpha: 'AB',
    startNumber: '12345700',
    endNumber: '12345799',
    reason: '2',
  });

  for (const [name, xml] of Object.entries(samples)) {
    await fs.writeFile(join(outDir, name), xml, 'utf8');
    console.log(`✓ ${name}`);
  }

  console.log(`\n共 ${Object.keys(samples).length} 份 sample XML → ${outDir}`);
  console.log('\n驗證：');
  console.log('  - namespace 應為 F0401:4.1 / F0501:4.1 / F0701:4.1 / G0401:4.1 / G0501:4.1 / E0402:4.1');
  console.log('  - Amount 區塊應含 SalesAmount / FreeTaxSalesAmount / ZeroTaxSalesAmount');
  console.log('  - 有 xmllint 可跑：xmllint --noout scratch/xml-samples/*.xml');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
