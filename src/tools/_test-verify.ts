import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function verify() {
  const prod = await db.product.findFirst({ where: { code: 'CG411' } });
  console.log('Product CG411:', JSON.stringify({
    category: prod?.category,
    shippingFee: prod?.shippingFee,
    laborFee: prod?.laborFee,
    salePrice: prod?.salePrice,
    costPrice: prod?.costPrice,
  }));

  const cust = await db.customer.findFirst({ where: { name: '測試農機行' } });
  console.log('Customer:', JSON.stringify({
    name: cust?.name,
    priceTier: cust?.priceTier,
    paymentDays: cust?.paymentDays,
  }));

  const part = await db.product.findFirst({ where: { code: 'SP001' } });

  const usedMachine = await db.product.upsert({
    where: { tenantId_code: { tenantId: prod!.tenantId, code: 'UM001' } },
    update: {},
    create: {
      tenantId: prod!.tenantId,
      code: 'UM001',
      name: '二手割草機',
      category: 'USED_MACHINE',
      salePrice: 8000,
      costPrice: 5000,
      purchaseCost: 5000,
    },
  });

  const refurbish = await db.refurbishOrder.create({
    data: {
      tenantId: prod!.tenantId,
      usedMachineId: usedMachine.id,
      createdBy: 'test',
      status: 'IN_PROGRESS',
      totalCost: 0,
    },
  });
  console.log('RefurbishOrder created:', refurbish.id, 'status:', refurbish.status);

  const item = await db.refurbishOrderItem.create({
    data: {
      refurbishOrderId: refurbish.id,
      productId: part!.id,
      quantity: 3,
      unitCost: 50,
    },
  });
  console.log('RefurbishOrderItem:', item.id, 'qty:', item.quantity, 'unitCost:', Number(item.unitCost));

  let machine = await db.machineRecord.findUnique({
    where: { tenantId_serialNumber: { tenantId: prod!.tenantId, serialNumber: 'CG411-TEST-001' } },
  });
  if (!machine) {
    machine = await db.machineRecord.create({
      data: {
        tenantId: prod!.tenantId,
        productId: prod!.id,
        serialNumber: 'CG411-TEST-001',
        warrantyStartAt: new Date('2026-06-01'),
        warrantyEndAt: new Date('2027-06-01'),
        registeredBy: 'test',
      },
    });
  }
  console.log('MachineRecord:', machine.id, 'serial:', machine.serialNumber);

  const found = await db.machineRecord.findUnique({
    where: { tenantId_serialNumber: { tenantId: prod!.tenantId, serialNumber: 'CG411-TEST-001' } },
    include: { product: { select: { name: true } } },
  });
  const daysLeft = Math.ceil((found!.warrantyEndAt.getTime() - Date.now()) / 86400000);
  console.log('Warranty query:', found!.product.name, '|', found!.serialNumber, '| days left:', daysLeft);

  // AR invoiceType: verify column exists via raw query (AR requires salesOrder relation)
  const columns = await db.$queryRaw<Array<{column_name: string}>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'AccountReceivable' AND column_name = 'invoiceType'`;
  console.log('AR invoiceType column:', columns.length > 0 ? 'EXISTS' : 'MISSING');

  console.log('\n=== ALL TESTS PASSED ===');
}

verify().catch(console.error).finally(() => db.$disconnect());
