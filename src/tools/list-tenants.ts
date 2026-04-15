import 'dotenv/config';
import { prisma } from '../shared/prisma.js';

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, companyName: true, lineChannelId: true },
  });
  console.log(tenants);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
