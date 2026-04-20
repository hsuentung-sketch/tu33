/**
 * Bootstrap a new tenant (company) + first ADMIN employee — interactive.
 *
 * Usage:
 *   npx tsx src/tools/bootstrap-tenant.ts
 *
 * Prompts for:
 *   - Company info (name / taxId / address / phone / email)
 *   - LINE Messaging API channel (id / secret / access token)
 *   - LINE Login channel ID (for LIFF → tenant mapping via settings.lineLoginChannelId)
 *   - First ADMIN employee (employeeId / name / password)
 *
 * Run this ONCE per new company after:
 *   1. Supabase project ready + schema pushed (`npx prisma db push`)
 *   2. DATABASE_URL in .env pointing at that new DB
 *
 * Prints afterwards:
 *   - Tenant ID (goes in LINE webhook URL)
 *   - Webhook URL to paste into LINE Developers Console
 *   - LIFF endpoint URL to configure
 *
 * Legacy positional-arg mode (backward compat):
 *   npx tsx src/tools/bootstrap-tenant.ts "<companyName>" "<adminName>" [lineUserId]
 *   → uses process.env LINE_* as that tenant's channel creds.
 */
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { prisma as db } from '../shared/prisma.js';

async function runLegacy(companyName: string, adminName: string, lineUserId?: string) {
  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelId || !channelSecret || !accessToken) {
    console.error('Missing LINE_CHANNEL_ID / LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN in env');
    process.exit(1);
  }

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

  const employee =
    (await db.employee.findFirst({ where: { tenantId: tenant.id, role: 'ADMIN' } })) ??
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

  console.log('\n=== Bootstrap complete (legacy mode) ===');
  console.log('Tenant ID      :', tenant.id);
  console.log('Admin employee :', employee.name, `(${employee.employeeId})`);
  console.log('\n⚠ 此模式未設密碼，請用 set-password.ts 建立後台登入密碼：');
  console.log(`  npx tsx src/tools/set-password.ts ${employee.employeeId} <新密碼> --tenant "${companyName}"`);
}

async function runInteractive() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, required = true): Promise<string> => {
    while (true) {
      const ans = (await rl.question(q)).trim();
      if (ans || !required) return ans;
      console.log('  ↳ 必填，請再輸入');
    }
  };

  try {
    console.log('=== ERP 新公司初始化 ===\n');
    const dbUrl = process.env.DATABASE_URL ?? '';
    console.log('連線的資料庫：', dbUrl.replace(/:([^:@]+)@/, ':****@') || '(未設)');
    console.log('');
    const go = await ask('確定要在這個 DB 建立新 Tenant？(yes/no) ');
    if (go.toLowerCase() !== 'yes') {
      console.log('已取消。');
      return;
    }

    console.log('\n--- 公司資料 ---');
    const companyName = await ask('公司名稱：');
    const taxId = await ask('統一編號（可空）：', false);
    const address = await ask('公司地址（可空）：', false);
    const phone = await ask('公司電話（可空）：', false);
    const email = await ask('公司 Email（可空）：', false);

    console.log('\n--- LINE Messaging API ---');
    const lineChannelId = await ask('Messaging channel ID（webhook 識別租戶用）：');
    const lineChannelSecret = await ask('Messaging channel secret：');
    const lineAccessToken = await ask('Messaging channel access token：');

    console.log('\n--- LINE Login / LIFF（沒做 LIFF 可跳過）---');
    const lineLoginChannelId = await ask('LINE Login channel ID（可空）：', false);

    console.log('\n--- 第一個 ADMIN 員工（後台登入用）---');
    const employeeId = await ask('員工編號（例：admin001）：');
    const employeeName = await ask('員工姓名：');
    const employeePhone = await ask('員工電話（可空）：', false);
    console.log('  （注意：密碼輸入會可見。建議 bootstrap 後立刻進後台改密碼）');
    const password = await ask('後台登入密碼（至少 6 字元）：');
    if (password.length < 6) {
      console.log('密碼太短，已中止。');
      return;
    }

    console.log('\n--- 確認 ---');
    console.log(`公司：${companyName}${taxId ? ` (統編 ${taxId})` : ''}`);
    console.log(`Messaging channel：${lineChannelId}`);
    console.log(`Login channel：${lineLoginChannelId || '(無)'}`);
    console.log(`ADMIN：${employeeId} ${employeeName}`);
    const ok = await ask('\n建立？(yes/no) ');
    if (ok.toLowerCase() !== 'yes') {
      console.log('已取消。');
      return;
    }

    const dup = await db.tenant.findFirst({
      where: { lineChannelId },
      select: { id: true, companyName: true },
    });
    if (dup) {
      console.log(`\n❌ LINE channel ID 已被 "${dup.companyName}" (${dup.id}) 使用，中止。`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { tenant, employee } = await db.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          companyName,
          taxId: taxId || null,
          address: address || null,
          phone: phone || null,
          email: email || null,
          lineChannelId,
          lineChannelSecret,
          lineAccessToken,
          modules: ['sales', 'purchase', 'accounting', 'inventory'],
          settings: {
            taxRate: 0.05,
            currency: 'TWD',
            defaultPaymentDays: 30,
            overdueAlertDays: 15,
            companyHeader: companyName,
            ...(lineLoginChannelId ? { lineLoginChannelId } : {}),
          },
        },
      });
      const e = await tx.employee.create({
        data: {
          tenantId: t.id,
          employeeId,
          name: employeeName,
          phone: employeePhone || null,
          role: 'ADMIN',
          passwordHash,
          isActive: true,
        },
      });
      return { tenant: t, employee: e };
    });

    const baseUrl = process.env.PUBLIC_BASE_URL ?? 'https://<your-app>.fly.dev';

    console.log('\n=== 建立成功 ===\n');
    console.log(`Tenant ID:  ${tenant.id}`);
    console.log(`Employee:   ${employee.employeeId} (${employee.name}) — ADMIN\n`);
    console.log('下一步：');
    console.log('  1. LINE Messaging API → Webhook URL 設為：');
    console.log(`       ${baseUrl}/webhook/${tenant.id}`);
    console.log('     按 Verify 應顯示 Success。');
    if (lineLoginChannelId) {
      console.log('  2. LIFF Endpoint URL 設為：');
      console.log(`       ${baseUrl}/liff/quotation.html`);
    }
    console.log('  3. 瀏覽器開：');
    console.log(`       ${baseUrl}/admin`);
    console.log(`     用 ${employeeId} + 剛設的密碼登入。`);
    console.log('  4. 登入後到「員工」頁建立其他同事帳號。\n');
  } finally {
    rl.close();
    await db.$disconnect();
  }
}

async function main() {
  const [a, b, c] = process.argv.slice(2);
  if (a && b) {
    await runLegacy(a, b, c);
    await db.$disconnect();
  } else {
    await runInteractive();
  }
}

main().catch((err) => {
  console.error('\n❌ 錯誤：', err);
  process.exit(1);
});
