/**
 * Import customers from 宗佑農機「下游.xls」.
 *
 * Structure: 18 sheets, each sheet name = customer name.
 * No structured contact info in the file — creates Customer records
 * from sheet names with default priceTier=1 (can be adjusted in admin).
 *
 * Usage:
 *   npx tsx src/tools/import-agri-customers.ts <tenantId> <path-to-xls>
 */
import 'dotenv/config';
import XLSX from 'xlsx';
import { prisma as db } from '../shared/prisma.js';

async function importAgriCustomers(tenantId: string, filePath: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const wb = XLSX.readFile(filePath);
  const names = wb.SheetNames;
  console.log(`Found ${names.length} sheets (customers): ${names.join(', ')}`);

  let created = 0;
  let skipped = 0;

  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) { skipped++; continue; }

    const existing = await db.customer.findUnique({
      where: { tenantId_name: { tenantId, name: trimmed } },
    });
    if (existing) {
      console.log(`  skip (exists): ${trimmed}`);
      skipped++;
      continue;
    }

    await db.customer.create({
      data: {
        tenantId,
        name: trimmed,
        priceTier: 1,
        paymentDays: 30,
      },
    });
    console.log(`  created: ${trimmed}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

const [, , tenantId, filePath] = process.argv;
if (!tenantId || !filePath) {
  console.error('Usage: npx tsx src/tools/import-agri-customers.ts <tenantId> <path-to-xls>');
  process.exit(1);
}

importAgriCustomers(tenantId, filePath)
  .catch((err) => { console.error('Import failed:', err); process.exit(1); })
  .finally(() => db.$disconnect());
