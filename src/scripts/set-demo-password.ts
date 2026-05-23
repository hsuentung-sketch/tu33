import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../shared/prisma.js';

async function main() {
  const hash = await bcrypt.hash('demo1234', 10);
  await prisma.employee.update({
    where: { id: 'emp_demo_1' },
    data: { passwordHash: hash, passwordSetAt: new Date() },
  });
  console.log('Done: E0001 / demo1234');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
