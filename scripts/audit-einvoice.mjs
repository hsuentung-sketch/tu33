// 一次性：dump 潤樋 tenant 的電子發票設定現狀，供稽核就緒度比對。
import 'dotenv/config';
const { prisma } = await import('../src/shared/prisma.ts');

const tenants = await prisma.tenant.findMany({
  select: { id: true, companyName: true, taxId: true, address: true, settings: true },
});
for (const t of tenants) {
  const ein = (t.settings ?? {}).einvoice ?? {};
  console.log('=== Tenant:', t.companyName, '===');
  console.log('taxId:', t.taxId, '| address:', t.address);
  console.log('einvoice settings:', JSON.stringify(ein, null, 2));
  const pools = await prisma.einvoiceNumberPool.findMany({ where: { tenantId: t.id } });
  console.log('pools:', pools.length);
  for (const p of pools) {
    console.log('  -', p.yearMonth, p.trackAlpha, p.rangeStart + '~' + p.rangeEnd,
      'next=' + p.nextNumber, 'active=' + p.isActive, 'branchId=' + p.branchId);
  }
  const invs = await prisma.einvoice.findMany({
    where: { tenantId: t.id },
    orderBy: { createdAt: 'asc' },
    select: { invoiceNo: true, invoiceDate: true, status: true, totalAmount: true,
      buyerTaxId: true, buyerName: true, xmlBody: true, createdAt: true, branchId: true },
  });
  console.log('einvoice rows:', invs.length);
  for (const i of invs) {
    console.log('  -', i.invoiceNo, '| date=' + i.invoiceDate.toISOString().slice(0,10),
      '| status=' + i.status, '| $' + i.totalAmount,
      '| buyer=' + (i.buyerTaxId || 'B2C') + '/' + i.buyerName,
      '| branchId=' + i.branchId,
      '| createdAt=' + i.createdAt.toISOString().slice(0,16),
      '| hasXml=' + (i.xmlBody ? 'Y' : 'N'));
  }
  console.log('');
}
await prisma.$disconnect();
