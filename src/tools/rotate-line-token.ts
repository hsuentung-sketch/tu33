/**
 * Rotate the LINE channel access token for a tenant.
 *
 * The webhook reads the token from Tenant.lineAccessToken in the DB
 * (not from env), so after reissuing a token in LINE Developers Console
 * you must update the DB too. Run this script for that.
 *
 * Usage:
 *   tsx src/tools/rotate-line-token.ts <tenantId> <new-access-token>
 *
 * Or, if the new token is already in your .env as LINE_CHANNEL_ACCESS_TOKEN:
 *   tsx src/tools/rotate-line-token.ts <tenantId> --from-env
 */
import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function main() {
  const [tenantId, tokenArg] = process.argv.slice(2);
  if (!tenantId || !tokenArg) {
    console.error(
      'Usage: tsx src/tools/rotate-line-token.ts <tenantId> <new-access-token|--from-env>',
    );
    process.exit(1);
  }

  const newToken =
    tokenArg === '--from-env' ? process.env.LINE_CHANNEL_ACCESS_TOKEN : tokenArg;
  if (!newToken) {
    console.error('No access token provided (and env LINE_CHANNEL_ACCESS_TOKEN is empty)');
    process.exit(1);
  }

  // Sanity: verify the token against LINE before persisting.
  const verify = await fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: 'Bearer ' + newToken },
  });
  if (!verify.ok) {
    const body = await verify.text();
    console.error(`LINE API rejected the token (status ${verify.status}): ${body}`);
    process.exit(1);
  }
  const info = (await verify.json()) as { displayName?: string; basicId?: string };
  console.log(`LINE API verified: ${info.displayName} (${info.basicId})`);

  const before = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { companyName: true, lineAccessToken: true },
  });
  if (!before) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const updated = await db.tenant.update({
    where: { id: tenantId },
    data: { lineAccessToken: newToken },
  });

  console.log('\n=== Rotation complete ===');
  console.log('Tenant     :', updated.companyName);
  console.log('Old (last 20):', before.lineAccessToken?.slice(-20));
  console.log('New (last 20):', updated.lineAccessToken?.slice(-20));
  console.log('\nRemember to also update LINE_CHANNEL_ACCESS_TOKEN in Render env.');

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
