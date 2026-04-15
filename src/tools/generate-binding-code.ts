/**
 * Generate a 6-char binding code for an employee so they can link LINE.
 *
 * Usage:
 *   npx tsx src/tools/generate-binding-code.ts <employeeCode>
 *   npx tsx src/tools/generate-binding-code.ts --list
 *
 * `<employeeCode>` is the human employeeId (e.g. "001"), not the cuid.
 * Code expires in 10 minutes. Employee then sends `綁定 XXXXXX` to the bot.
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';
import { createBindingCode } from '../modules/core/auth/auth.service.js';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx src/tools/generate-binding-code.ts <employeeCode|--list>');
    process.exit(1);
  }

  if (arg === '--list') {
    const employees = await prisma.employee.findMany({
      where: { isActive: true, lineUserId: null },
      select: { id: true, employeeId: true, name: true, role: true },
      orderBy: { employeeId: 'asc' },
    });
    if (!employees.length) {
      console.log('沒有尚未綁定的員工。');
    } else {
      console.log('尚未綁定 LINE 的員工：');
      for (const e of employees) {
        console.log(`  ${e.employeeId}  ${e.name}  (${e.role})`);
      }
    }
    await prisma.$disconnect();
    return;
  }

  const employee = await prisma.employee.findFirst({
    where: { employeeId: arg, isActive: true },
  });
  if (!employee) {
    console.error(`找不到員工編號 "${arg}"（或該員工已停用）`);
    console.error('用 --list 看目前可綁定的員工。');
    process.exit(1);
  }
  if (employee.lineUserId) {
    console.error(`員工 ${employee.name} (${employee.employeeId}) 已綁定 LINE，無需再產生綁定碼。`);
    process.exit(1);
  }

  const { code, expiresAt } = await createBindingCode(employee.tenantId, employee.id);

  console.log('─'.repeat(48));
  console.log(`員工：${employee.name}（${employee.employeeId}）`);
  console.log(`綁定碼：${code}`);
  console.log(`有效期限：${expiresAt.toLocaleString('zh-TW')}`);
  console.log('─'.repeat(48));
  console.log('請該員工在 LINE 聊天室輸入下列文字：');
  console.log(`  綁定 ${code}`);
  console.log('─'.repeat(48));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
