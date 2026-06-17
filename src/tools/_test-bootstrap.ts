import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma as db } from '../shared/prisma.js';

async function run() {
  let tenant = await db.tenant.findFirst({ where: { companyName: 'Test Agri Co' } });
  if (!tenant) {
    tenant = await db.tenant.create({
      data: {
        companyName: 'Test Agri Co',
        lineChannelId: 'test',
        lineChannelSecret: 'test',
        lineAccessToken: 'test',
        modules: ['sales', 'purchase', 'accounting', 'inventory'],
        settings: { einvoice: { enabled: false } },
      },
    });
    console.log('Tenant created:', tenant.id);
  } else {
    console.log('Tenant exists:', tenant.id);
  }

  let emp = await db.employee.findFirst({ where: { tenantId: tenant.id, employeeId: 'ADMIN' } });
  if (!emp) {
    const hash = await bcrypt.hash('test1234', 10);
    emp = await db.employee.create({
      data: {
        tenantId: tenant.id,
        employeeId: 'ADMIN',
        name: 'Admin',
        role: 'ADMIN',
        passwordHash: hash,
        isActive: true,
      },
    });
    console.log('Employee created:', emp.id);
  } else {
    console.log('Employee exists:', emp.id);
  }

  console.log('TENANT_ID=' + tenant.id);
  console.log('EMP_ID=' + emp.id);
}

run()
  .catch((e) => console.error(e))
  .finally(() => db.$disconnect());
