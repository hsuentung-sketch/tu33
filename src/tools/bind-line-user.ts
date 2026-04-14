/**
 * Bind a LINE userId to an existing employee record.
 *
 * Usage:
 *   tsx src/tools/bind-line-user.ts <tenantId> <employeeId> <lineUserId>
 *
 * Example:
 *   tsx src/tools/bind-line-user.ts cmny8yzue0000ls9yq7mjm5ks 001 U5f370a419dc955f64791267680f02e51
 *
 * Find your lineUserId by:
 *   1. Send any message to the Bot after webhook is wired
 *   2. Check Render logs for `webhook event received ... userId: U...`
 *   3. Copy the U-prefixed string
 */
import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function main() {
  const [tenantId, employeeId, lineUserId] = process.argv.slice(2);

  if (!tenantId || !employeeId || !lineUserId) {
    console.error(
      'Usage: tsx src/tools/bind-line-user.ts <tenantId> <employeeId> <lineUserId>',
    );
    process.exit(1);
  }

  if (!lineUserId.startsWith('U')) {
    console.error('lineUserId should start with "U" (LINE userId format)');
    process.exit(1);
  }

  const employee = await db.employee.findFirst({
    where: { tenantId, employeeId },
  });

  if (!employee) {
    console.error(`No employee found with tenantId=${tenantId} employeeId=${employeeId}`);
    process.exit(1);
  }

  const updated = await db.employee.update({
    where: { id: employee.id },
    data: { lineUserId },
  });

  console.log('\n=== Binding complete ===');
  console.log('Employee   :', updated.name, `(${updated.employeeId})`);
  console.log('LINE userId:', updated.lineUserId);
  console.log('Role       :', updated.role);
  console.log('\nYou can now send "menu" to the Bot and it will recognise you.');

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
