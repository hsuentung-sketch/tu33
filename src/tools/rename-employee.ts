/**
 * Rename an employee by id.
 *
 * Usage:
 *   tsx src/tools/rename-employee.ts <tenantId> <employeeId> "<newName>"
 */
import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function main() {
  const [tenantId, employeeId, newName] = process.argv.slice(2);
  if (!tenantId || !employeeId || !newName) {
    console.error('Usage: tsx src/tools/rename-employee.ts <tenantId> <employeeId> "<newName>"');
    process.exit(1);
  }
  const emp = await db.employee.findFirst({ where: { tenantId, employeeId } });
  if (!emp) {
    console.error(`Employee not found: tenantId=${tenantId} employeeId=${employeeId}`);
    process.exit(1);
  }
  const updated = await db.employee.update({ where: { id: emp.id }, data: { name: newName } });
  console.log(`Renamed ${emp.name} → ${updated.name}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
