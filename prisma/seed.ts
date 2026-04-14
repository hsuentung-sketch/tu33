import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: 'demo-tenant' },
    update: {},
    create: {
      id: 'demo-tenant',
      companyName: '潤樋實業股份有限公司',
      address: '台灣',
      phone: '02-0000-0000',
      email: 'contact@runtong.example.com',
      modules: ['sales', 'purchase', 'accounting'],
      settings: {
        taxRate: 0.05,
        currency: 'TWD',
        quotationPrefix: 'Q',
        salesPrefix: 'S',
        purchasePrefix: 'P',
        defaultPaymentDays: 30,
        overdueAlertDays: 15,
        companyHeader: '潤樋實業股份有限公司',
        pdfFooter: '感謝您的支持',
      },
    },
  });

  // Admin employee
  await prisma.employee.upsert({
    where: { tenantId_employeeId: { tenantId: tenant.id, employeeId: '001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      employeeId: '001',
      name: '系統管理員',
      role: 'ADMIN',
      phone: '0900-000-000',
      email: 'admin@runtong.example.com',
    },
  });

  // Sample products
  const products = [
    { code: 'EK-SS-6280', name: 'EK-SS-6280 1/200', category: '半合成切削液', salePrice: 4800, costPrice: 3200 },
    { code: 'EK-SS-6336', name: 'EK-SS-6336 1/200', category: '半合成切削液', salePrice: 5200, costPrice: 3600 },
    { code: 'EK-C-215', name: 'EK-C-215', category: '切削液', salePrice: 17200, costPrice: 12000 },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: p.code } },
      update: {},
      create: { tenantId: tenant.id, ...p },
    });
  }

  // Sample customer
  await prisma.customer.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: '毅金精密股份有限公司' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: '毅金精密股份有限公司',
      contactName: '王先生',
      phone: '02-1234-5678',
      address: '新北市',
      paymentDays: 30,
    },
  });

  // Sample supplier
  await prisma.supplier.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: '示範供應商有限公司' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: '示範供應商有限公司',
      type: '切削液原料',
      contactName: '李小姐',
      phone: '03-1111-2222',
      paymentDays: 60,
    },
  });

  console.log('Seed completed: tenant=%s', tenant.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
