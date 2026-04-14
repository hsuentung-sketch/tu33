/**
 * One-off: persist the LINE Login channel ID into tenant.settings so the
 * LIFF auth middleware can resolve the tenant from ID-token audience.
 *
 * Usage:
 *   tsx src/tools/set-login-channel.ts <tenantId> <loginChannelId>
 */
import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function main() {
  const [tenantId, loginChannelId] = process.argv.slice(2);
  if (!tenantId || !loginChannelId) {
    console.error('Usage: tsx src/tools/set-login-channel.ts <tenantId> <loginChannelId>');
    process.exit(1);
  }

  const t = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!t) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const settings = { ...(t.settings as any), lineLoginChannelId: loginChannelId };
  await db.tenant.update({ where: { id: tenantId }, data: { settings } });

  console.log(`Updated tenant ${t.companyName}: lineLoginChannelId = ${loginChannelId}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
