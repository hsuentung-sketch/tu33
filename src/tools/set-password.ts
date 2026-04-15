/**
 * Set / reset a web-console password for an employee.
 *
 * Usage:
 *   npx tsx src/tools/set-password.ts <employeeCode> <newPassword>
 *   npx tsx src/tools/set-password.ts <employeeCode> <newPassword> --tenant "<公司名關鍵字>"
 *
 * If the same employeeId exists in multiple tenants, pass --tenant to
 * disambiguate (substring match, case-insensitive).
 *
 * Bootstraps the first ADMIN login — there is no web UI to set the
 * initial password yet.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../shared/prisma.js';

async function main() {
  const [, , employeeCode, newPassword, ...rest] = process.argv;
  if (!employeeCode || !newPassword) {
    console.error('Usage: tsx src/tools/set-password.ts <employeeCode> <newPassword> [--tenant "<關鍵字>"]');
    process.exit(1);
  }
  if (newPassword.length < 6) {
    console.error('密碼至少 6 碼');
    process.exit(1);
  }

  const tenantIdx = rest.indexOf('--tenant');
  const tenantHint = tenantIdx >= 0 ? rest[tenantIdx + 1] : undefined;

  const employees = await prisma.employee.findMany({
    where: {
      employeeId: employeeCode,
      isActive: true,
      ...(tenantHint
        ? { tenant: { companyName: { contains: tenantHint, mode: 'insensitive' }, isActive: true } }
        : { tenant: { isActive: true } }),
    },
    include: { tenant: true },
  });

  if (!employees.length) {
    console.error(`找不到員工編號 "${employeeCode}"${tenantHint ? `（租戶關鍵字 ${tenantHint}）` : ''}`);
    process.exit(1);
  }
  if (employees.length > 1) {
    console.error('多個租戶下有相同員工編號，請加 --tenant "<公司名關鍵字>"：');
    for (const e of employees) {
      console.error(`  • ${e.employeeId} ${e.name}  @ ${e.tenant.companyName}`);
    }
    process.exit(1);
  }

  const emp = employees[0];
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.employee.update({ where: { id: emp.id }, data: { passwordHash: hash } });

  console.log('─'.repeat(48));
  console.log(`已設定密碼`);
  console.log(`  員工：${emp.name}（${emp.employeeId}） role=${emp.role}`);
  console.log(`  租戶：${emp.tenant.companyName}`);
  console.log('─'.repeat(48));
  console.log('登入頁：/admin/login.html');
  console.log('若多租戶，登入時請填「公司名稱」欄位。');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
