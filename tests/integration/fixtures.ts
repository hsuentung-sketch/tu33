import { prisma } from '../../src/shared/prisma.js';

export interface Fixtures {
  tenantId: string;
  employeeId: string;
  customerId: string;
  supplierId: string;
  productId: string;
  productName: string;
}

/**
 * Create a minimal fixture graph for a test: tenant + employee + customer + supplier + product.
 */
export async function seedFixtures(): Promise<Fixtures> {
  const tenant = await prisma.tenant.create({
    data: {
      companyName: 'Test Co',
      modules: ['sales', 'purchase', 'accounting'],
      isActive: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      tenantId: tenant.id,
      employeeId: '001',
      name: 'Test Admin',
      role: 'ADMIN',
      isActive: true,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: 'Yi Jin Precision',
      paymentDays: 30,
    },
  });
  const supplier = await prisma.supplier.create({
    data: {
      tenantId: tenant.id,
      name: 'Demo Supplier',
      paymentDays: 60,
    },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      code: 'EK-C-215',
      name: 'EK-C-215',
      salePrice: 17200,
      costPrice: 12000,
    },
  });
  return {
    tenantId: tenant.id,
    employeeId: employee.id,
    customerId: customer.id,
    supplierId: supplier.id,
    productId: product.id,
    productName: product.name,
  };
}
