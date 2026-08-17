/**
 * EINV V4.8 檢測 Phase C — 壓力測試 N 張發票
 *
 * 用途：驗證 ERP → R2 → Turnkey → EINV 全鏈路在批量壓力下不掉件。
 *
 * Usage:
 *   npx tsx src/tools/pressure-test-invoices.ts --tenant "潤樋" --count 20
 *   npx tsx src/tools/pressure-test-invoices.ts --tenant "潤樋" --count 1000 --batch-size 100 --batch-delay 60
 *   npx tsx src/tools/pressure-test-invoices.ts --tenant "潤樋" --count 10 --dry-run
 *
 * Args:
 *   --tenant "<關鍵字>"     必填：租戶公司名關鍵字（substring）
 *   --count N               必填：要開的發票張數
 *   --batch-size N          預設 100：每批張數（批間有 delay 讓 Turnkey 消化）
 *   --batch-delay N         預設 60：批間秒數
 *   --dry-run               預設 false：只印計畫不實際開票
 *
 * 產出：docs/audit/einvoice-pressure-test-<YYYYMMDD-HHMM>.md
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '../shared/prisma.js';
import { issue as issueInvoice } from '../modules/accounting/einvoice/einvoice.service.js';

interface Args {
  tenantHint: string;
  count: number;
  batchSize: number;
  batchDelaySec: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const tenantHint = get('tenant');
  const count = Number(get('count'));
  const batchSize = Number(get('batch-size') ?? '100');
  const batchDelaySec = Number(get('batch-delay') ?? '60');
  const dryRun = has('dry-run');

  if (!tenantHint || !Number.isFinite(count) || count <= 0) {
    console.error('Usage: tsx pressure-test-invoices.ts --tenant "<關鍵字>" --count N [--batch-size 100] [--batch-delay 60] [--dry-run]');
    process.exit(1);
  }
  return { tenantHint, count, batchSize, batchDelaySec, dryRun };
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

async function resolveTenant(hint: string): Promise<{ id: string; name: string }> {
  const rows = await prisma.tenant.findMany({
    where: { companyName: { contains: hint, mode: 'insensitive' }, isActive: true },
    select: { id: true, companyName: true },
  });
  if (!rows.length) throw new Error(`找不到租戶 "${hint}"`);
  if (rows.length > 1) {
    throw new Error(`多筆匹配：${rows.map((r) => r.companyName).join(', ')}，請縮小 --tenant 關鍵字`);
  }
  return { id: rows[0].id, name: rows[0].companyName };
}

async function checkPoolCapacity(tenantId: string, need: number): Promise<{ available: number; period: string }> {
  const now = new Date();
  const roc = now.getFullYear() - 1911;
  const m = now.getMonth() + 1; // 1..12
  const oddStart = m % 2 === 1 ? m : m - 1;
  const period = `${roc}${String(oddStart).padStart(2, '0')}`;

  const pools = await prisma.einvoiceNumberPool.findMany({
    where: { tenantId, isActive: true, yearMonth: period, branchId: null },
  });
  const available = pools.reduce((s, p) => s + Math.max(0, p.rangeEnd - p.nextNumber + 1), 0);
  return { available, period };
}

async function runOne(tenantId: string, seq: number): Promise<{ invoiceNo: string }> {
  const unitPrice = randInt(100, 1000);
  const result = await issueInvoice(tenantId, {
    buyerName: '壓力測試買方',
    // B2C 二聯式：buyerTaxId 留空
    items: [
      {
        description: `壓力測試品項 #${seq}`,
        quantity: 1,
        unit: '個',
        unitPrice,
        taxType: '1',
      },
    ],
    taxType: '1',
    printFlag: 'N',
  });
  return { invoiceNo: (result as any).invoiceNo };
}

interface Failure {
  seq: number;
  error: string;
}

async function main() {
  const args = parseArgs();
  console.log('─'.repeat(60));
  console.log('EINV Phase C 壓力測試');
  console.log('─'.repeat(60));
  console.log(`租戶關鍵字: ${args.tenantHint}`);
  console.log(`張數: ${args.count}`);
  console.log(`批次: ${args.batchSize} 張 / 批`);
  console.log(`批間延遲: ${args.batchDelaySec} 秒`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log('');

  const tenant = await resolveTenant(args.tenantHint);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const cap = await checkPoolCapacity(tenant.id, args.count);
  console.log(`當期字軌可用數: ${cap.available} (期別 ${cap.period})`);
  if (cap.available < args.count) {
    console.error(`字軌不足！需 ${args.count} 張，僅剩 ${cap.available} 張。請先到 EINV 平台取字軌。`);
    process.exit(2);
  }
  console.log('');

  if (args.dryRun) {
    console.log('[DRY RUN] 不實際開票，退出。');
    await prisma.$disconnect();
    return;
  }

  const batches = Math.ceil(args.count / args.batchSize);
  const startedAt = Date.now();
  const failures: Failure[] = [];
  const invoiceNos: string[] = [];
  let doneCount = 0;

  for (let b = 0; b < batches; b++) {
    const batchStart = b * args.batchSize;
    const batchEnd = Math.min(batchStart + args.batchSize, args.count);
    const batchSize = batchEnd - batchStart;
    console.log(`[Batch ${b + 1}/${batches}] 開始 ${batchSize} 張（seq ${batchStart + 1}..${batchEnd}）`);
    const batchStartedAt = Date.now();

    for (let i = batchStart; i < batchEnd; i++) {
      const seq = i + 1;
      try {
        const { invoiceNo } = await runOne(tenant.id, seq);
        invoiceNos.push(invoiceNo);
        doneCount++;
        if (doneCount % 10 === 0 || doneCount === args.count) {
          const elapsed = Date.now() - startedAt;
          const rate = (doneCount / (elapsed / 1000)).toFixed(2);
          console.log(`  [${doneCount}/${args.count}] OK ${invoiceNo} elapsed=${fmtDuration(elapsed)} rate=${rate}/s`);
        }
      } catch (err: any) {
        failures.push({ seq, error: err?.message ?? String(err) });
        console.error(`  [${seq}] FAIL: ${err?.message ?? err}`);
      }
    }

    const batchDur = Date.now() - batchStartedAt;
    console.log(`[Batch ${b + 1}] 完成，耗時 ${fmtDuration(batchDur)}`);

    if (b < batches - 1 && args.batchDelaySec > 0) {
      console.log(`  → 等 ${args.batchDelaySec}s 讓 Turnkey 消化…`);
      await sleep(args.batchDelaySec * 1000);
    }
  }

  const totalMs = Date.now() - startedAt;
  const successRate = ((args.count - failures.length) / args.count * 100).toFixed(2);
  const avgRate = (args.count / (totalMs / 1000)).toFixed(2);

  console.log('');
  console.log('─'.repeat(60));
  console.log(`結果：${args.count - failures.length}/${args.count} 成功（${successRate}%）`);
  console.log(`總耗時: ${fmtDuration(totalMs)}  平均速率: ${avgRate} 張/秒`);
  console.log('─'.repeat(60));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const reportDir = path.resolve('docs/audit');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `einvoice-pressure-test-${stamp}.md`);
  const md = renderReport({
    tenant, args, doneCount, failures, invoiceNos, totalMs, avgRate, successRate, cap,
  });
  await fs.writeFile(reportPath, md, 'utf8');
  console.log(`報告：${reportPath}`);
  console.log('');
  console.log('===== REPORT BEGIN =====');
  console.log(md);
  console.log('===== REPORT END =====');

  await prisma.$disconnect();
  process.exit(failures.length > 0 ? 1 : 0);
}

function renderReport(o: {
  tenant: { id: string; name: string };
  args: Args;
  doneCount: number;
  failures: Failure[];
  invoiceNos: string[];
  totalMs: number;
  avgRate: string;
  successRate: string;
  cap: { available: number; period: string };
}): string {
  const now = new Date().toISOString();
  const first = o.invoiceNos[0] ?? 'N/A';
  const last = o.invoiceNos[o.invoiceNos.length - 1] ?? 'N/A';
  return `# EINV V4.8 Phase C 壓力測試報告

- 執行時間: ${now}
- 租戶: ${o.tenant.name} (${o.tenant.id})
- 期別: ${o.cap.period}
- 目標張數: ${o.args.count}
- 成功: ${o.doneCount} / ${o.args.count} (${o.successRate}%)
- 失敗: ${o.failures.length}
- 總耗時: ${fmtDuration(o.totalMs)}
- 平均速率: ${o.avgRate} 張/秒
- 批次策略: ${o.args.batchSize} 張/批, 批間 ${o.args.batchDelaySec}s

## 開立區間

- 起: ${first}
- 迄: ${last}

## 失敗清單

${o.failures.length === 0 ? '_無_' : o.failures.map((f) => `- seq ${f.seq}: ${f.error}`).join('\n')}

## 後續人工驗收

- [ ] Linode Turnkey UpCast 消化：\`ssh runtong@172.104.74.184 "ls /opt/turnkey/app/linux/EINVTurnkey/UpCast/B2SSTORAGE/F0401/BAK/$(date +%Y%m%d)/ | wc -l"\`
- [ ] Linode SendFile 送出：\`ssh runtong@172.104.74.184 "ls /opt/turnkey/app/linux/EINVTurnkey/SendFile/BAK/$(date +%Y%m%d)/ | wc -l"\`
- [ ] EINV 測試站對帳（wwwtest.einvoice.nat.gov.tw）核對 ${o.doneCount} 張全部入帳
- [ ] 若有 ERR：讀 \`/var/log/turnkey.log\` 找根因
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
