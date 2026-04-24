/**
 * CLI: scan each tenant's `turnkeyOutboundDir` for reply XML files and
 * update the matching Einvoice row's status (issued → confirmed/rejected).
 *
 * Usage:
 *   npx tsx src/tools/sync-einvoice-status.ts              # all tenants
 *   npx tsx src/tools/sync-einvoice-status.ts <tenantId>   # single tenant
 */
import 'dotenv/config';
import { syncAllTenants, syncTenant } from '../modules/accounting/einvoice/turnkey-reader.js';

async function main() {
  const tenantId = process.argv[2];
  const results = tenantId ? [await syncTenant(tenantId)] : await syncAllTenants();
  for (const r of results) {
    console.log(
      `[${r.tenantId}] scanned=${r.scanned} updated=${r.updated} skipped=${r.skipped} errors=${r.errors}`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
