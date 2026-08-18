/**
 * 手動新增電子發票字軌配號池（EINV CSV UI 匯入卡住時的救援 CLI）。
 *
 * Usage:
 *   fly ssh console -a erp-line-bot \
 *     -C "node /app/dist/tools/add-number-pool.js \
 *         --tenant 潤樋 --year-month 1150910 --track LO \
 *         --start 99980950 --end 99981949"
 */
import 'dotenv/config';
import { prisma } from '../shared/prisma.js';

async function main() {
  const argv = process.argv.slice(2);
  const get = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const tenantHint = get('tenant');
  const yearMonth = get('year-month');
  const track = get('track');
  const start = Number(get('start'));
  const end = Number(get('end'));
  const branchId = get('branch') ?? null;

  if (!tenantHint || !yearMonth || !track || !Number.isFinite(start) || !Number.isFinite(end)) {
    console.error('Usage: add-number-pool --tenant <關鍵字> --year-month 1150910 --track LO --start 99980950 --end 99981949 [--branch <id>]');
    process.exit(1);
  }
  if (!/^\d{7}$/.test(yearMonth)) throw new Error(`year-month 需 7 碼（如 1150910）`);
  if (!/^[A-Z]{2}$/.test(track)) throw new Error('track 需兩碼大寫英文');
  if (end <= start) throw new Error('end 必須 > start');

  const tenants = await prisma.tenant.findMany({
    where: { companyName: { contains: tenantHint, mode: 'insensitive' }, isActive: true },
    select: { id: true, companyName: true },
  });
  if (!tenants.length) throw new Error(`找不到租戶 "${tenantHint}"`);
  if (tenants.length > 1) throw new Error(`多筆匹配: ${tenants.map((t) => t.companyName).join(', ')}`);
  const tenant = tenants[0];

  const exists = await prisma.einvoiceNumberPool.findFirst({
    where: { tenantId: tenant.id, yearMonth, trackAlpha: track, rangeStart: start, branchId },
  });
  if (exists) {
    console.log(`已存在池 id=${exists.id}（yearMonth=${yearMonth} track=${track} start=${start}），跳過。`);
    await prisma.$disconnect();
    return;
  }

  const pool = await prisma.einvoiceNumberPool.create({
    data: {
      tenantId: tenant.id,
      yearMonth, trackAlpha: track,
      rangeStart: start, rangeEnd: end, nextNumber: start,
      branchId, isActive: true,
      note: 'imported via add-number-pool CLI',
    },
  });
  console.log(`已建立池 id=${pool.id}`);
  console.log(`  租戶: ${tenant.companyName}`);
  console.log(`  期別: ${yearMonth}   字軌: ${track}   ${start}~${end}（${end - start + 1} 張）`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
