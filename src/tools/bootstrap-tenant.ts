/**
 * Bootstrap script — creates the first Tenant + ADMIN employee.
 *
 * Usage:
 *   tsx src/tools/bootstrap-tenant.ts "<companyName>" "<adminName>" [lineUserId]
 *
 * Example:
 *   tsx src/tools/bootstrap-tenant.ts "潤樋實業股份有限公司" "管理員"
 *
 * The LINE credentials are read from process.env (the same values the
 * running service uses). After this script finishes it prints the
 * tenantId — use that in the LINE webhook URL:
 *   https://<your-host>/webhook/<tenantId>
 *
 * If lineUserId is omitted, the admin employee is created without a
 * LINE binding; you can run `tsx src/tools/bind-line-user.ts` later to
 * bind once you know your own userId.
 */
import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function main() {
  const [companyName, adminName, lineUserId] = process.argv.slice(2);

  if (!companyName || !adminName) {
    console.error(
      'Usage: tsx src/tools/bootstrap-tenant.ts "<companyName>" "<adminName>" [lineUserId]',
    );
    process.exit(1);
  }

  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelId || !channelSecret || !accessToken) {
    console.error(
      'Missing LINE_CHANNEL_ID / LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN in env',
    );
    process.exit(1);
  }

  // Idempotency — re-use existing tenant if companyName already taken.
  const existing = await db.tenant.findFirst({ where: { companyName } });
  const tenant =
    existing ??
    (await db.tenant.create({
      data: {
        companyName,
        lineChannelId: channelId,
        lineChannelSecret: channelSecret,
        lineAccessToken: accessToken,
        modules: ['sales', 'purchase', 'accounting', 'inventory'],
        settings: {
          taxRate: 0.05,
          currency: 'TWD',
          defaultPaymentDays: 30,
          overdueAlertDays: 15,
          companyHeader: companyName,
        },
      },
    }));

  // Seed an admin employee. Re-use if same employeeId already present.
  const employee =
    (await db.employee.findFirst({
      where: { tenantId: tenant.id, role: 'ADMIN' },
    })) ??
    (await db.employee.create({
      data: {
        tenantId: tenant.id,
        employeeId: '001',
        name: adminName,
        role: 'ADMIN',
        isActive: true,
        lineUserId: lineUserId ?? null,
      },
    }));

  console.log('\n=== Bootstrap complete ===');
  console.log('Tenant ID      :', tenant.id);
  console.log('Company        :', tenant.companyName);
  console.log('Admin employee :', employee.name, `(${employee.employeeId})`);
  console.log('LINE bound     :', employee.lineUserId ?? '(not yet)');
  console.log('\nWebhook URL for LINE Developers Console:');
  console.log(`  https://erp-line-bot.onrender.com/webhook/${tenant.id}`);
  console.log('\nNext steps:');
  console.log('  1. Put the URL above in LINE Developers → Messaging API → Webhook URL');
  console.log('  2. Press Verify');
  console.log('  3. Add the Bot as a friend and send "menu"');
  if (!employee.lineUserId) {
    console.log(
      '  4. The first message will be logged — grab your userId from Render logs and run bind-line-user.ts',
    );
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
