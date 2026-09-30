import 'dotenv/config';

/**
 * Demo 全套 seed（Docker UAT / 潛在客戶展示用）。全部為匿名示範資料。
 *
 * 用法：node dist/scripts/seed-demo-all.js [--force]   （Docker init 服務）
 *       npx tsx src/scripts/seed-demo-all.ts [--force]  （本機）
 *
 * 冪等：demo 租戶已存在視為已 seed，直接略過（--force 重跑；demo-seed 會先清掉舊 demo 資料）。
 * 注意：demo-seed 會清空全域 BillingPlan / VersionHistory，只能對專用 demo DB 執行。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '../shared/prisma.js';

const DEMO_TENANT_ID = 'demo_eco_company_001';
const DEMO_ADMIN_ID = 'emp_demo_1';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const existing = await prisma.tenant.findUnique({ where: { id: DEMO_TENANT_ID } });
  if (existing && !force) {
    console.log('[seed-demo-all] demo 租戶已存在，略過（--force 可重跑）');
    return;
  }

  // 編譯後（dist/*.js）用 node 跑；原始碼（*.ts）用 tsx 跑
  const ext = path.extname(__filename);
  const seed = path.join(__dirname, `demo-seed${ext}`);
  const [cmd, args] =
    ext === '.js'
      ? [process.execPath, [seed]]
      : [path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'), [seed]];
  console.log(`[seed-demo-all] ▶ ${path.basename(seed)}`);
  execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });

  await prisma.employee.update({
    where: { id: DEMO_ADMIN_ID },
    data: { passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), passwordSetAt: new Date() },
  });
  console.log(`[seed-demo-all] 完成 ✓  後台登入：E0001 / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error('[seed-demo-all] 失敗：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
