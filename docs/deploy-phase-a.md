# Phase A Deploy 交接檔 — 整批上 Production

> 由 Cowork 2026-05-25 產出。目標：將 v2.15.0 (20909c1) → HEAD (cebdd2f) 整批部署到 production。
> 涵蓋 f552f91 + v2.16.0 業績獎金 + P0-P2 backlog。

---

## 前置：Production 目前狀態

- Fly app: `erp-line-bot`（nrt region）
- 目前線上版本: **v2.15.0** (commit 20909c1)
- DB: Supabase PostgreSQL（DDL 走 SQL Editor 手動，不走 prisma migrate deploy）
- fly.toml 的 `release_command = 'npx prisma migrate deploy'` 會執行，但 `prisma/migrations/` 只有 `manual/` 目錄，Prisma 應不會報錯（沒有 pending migration）

## 待上線 Commits

```
cebdd2f chore: gitignore Claude Code session artifacts
d755c8d feat(platform): 執行 code-backlog P0-P2 ERP 端項目
fd79fc3 feat(commission): 業績獎金改用毛利−營業稅+員工稅率 (v2.16.0)
8b75d4b fix(build): 修復 f552f91 的編譯阻塞
f552f91 feat: #3-#6 Fly部署 + Demo API + 自動分錄 + 報表擴充
```

---

## Step 1: 編譯驗證

```bash
npm run build
```

確認 tsc clean，零 error。

## Step 2: 版本 bump

目前 package.json 版本應為 2.16.0（fd79fc3 已 bump）。
確認 CHANGELOG.md 有涵蓋以下內容：
- v2.16.0：業績獎金改用毛利計算 + Employee.taxDeductRate
- P0-2：lineUserId 複合唯一 + auth middleware 帶 tenantId
- P0-3a：Billing sync endpoints（platform API）
- P0-V：VersionUpgradeLog +commitHash + POST /versions/record
- P1-1：Tenant soft-delete + export + restore
- P2-fee：docs/module-keys.md

若 CHANGELOG 需更新，commit 為 `docs: CHANGELOG 補齊 v2.16.0 ~ P0-P2 內容`。

## Step 3: DDL 安全檢查（在 deploy 前跑）

### 3a. lineUserId 跨 tenant 重複檢查

連到 production DB 跑：

```sql
-- 檢查 Employee
SELECT "lineUserId", COUNT(DISTINCT "tenantId") AS tenant_count
FROM "Employee"
WHERE "lineUserId" IS NOT NULL
GROUP BY "lineUserId"
HAVING COUNT(DISTINCT "tenantId") > 1;

-- 檢查 Customer
SELECT "lineUserId", COUNT(DISTINCT "tenantId") AS tenant_count
FROM "Customer"
WHERE "lineUserId" IS NOT NULL
GROUP BY "lineUserId"
HAVING COUNT(DISTINCT "tenantId") > 1;
```

**預期結果**：0 rows（目前只有一個 production tenant，不可能跨 tenant 重複）。
**若有 rows**：需先手動處理重複才能跑 composite unique DDL。

### 3b. 確認現有表結構

```sql
-- 確認 Employee 目前有 lineUserId 的 unique index
SELECT indexname FROM pg_indexes WHERE tablename = 'Employee' AND indexname LIKE '%lineUserId%';
```

## Step 4: DDL 執行

到 **Supabase SQL Editor**，按以下順序執行（每段跑完確認無 error）：

### 4a. Accounting Phase A（f552f91 依賴）

```
檔案：prisma/migrations/manual/20260430_accounting_phase_a.sql
```

### 4b. Billing Management（f552f91 依賴）

```
檔案：prisma/migrations/manual/20260521_billing_management.sql
```

### 4c. Version Management（f552f91 依賴）

```
檔案：prisma/migrations/manual/20260521_version_management.sql
```

### 4d. Advanced Billing（f552f91 依賴）

```
檔案：prisma/migrations/manual/20260521_p0_3c_advanced_billing.sql
```

### 4e. lineUserId Composite Unique（P0-2）

```
檔案：prisma/migrations/manual/20260521_lineUserId_composite_unique.sql
```

### 4f. 本批新增欄位（v2.16.0 + P0-P2，無獨立 SQL 檔，手動 ALTER）

```sql
-- v2.16.0 業績獎金
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "taxDeductRate" DECIMAL(5,2);
ALTER TABLE "SalesItem" ADD COLUMN IF NOT EXISTS "costAtSale" DECIMAL(12,2);

-- P1-1 Churn soft-delete
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;

-- P0-V Version commitHash
ALTER TABLE "VersionUpgradeLog" ADD COLUMN IF NOT EXISTS "commitHash" TEXT;

-- Version subscription previousVersion（若 d755c8d 有加）
ALTER TABLE "TenantVersionSubscription" ADD COLUMN IF NOT EXISTS "previousVersion" TEXT;
```

## Step 5: Fly Deploy

```bash
cd D:\Claude\ERP
git push origin main
fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD) -a erp-line-bot
```

等 deploy 完成，觀察 `release_command` 是否成功（Prisma migrate deploy 應為 no-op）。

## Step 6: 部署後驗證

### 6a. 基本健康

```bash
curl https://erp-line-bot.fly.dev/health
# 預期：{"ok":true}

curl https://erp-line-bot.fly.dev/api/version
# 預期：commit 對到 HEAD（cebdd2f 或更新的 commit）

fly logs -a erp-line-bot --since 5m
# 檢查無 ERROR / FATAL
```

### 6b. Platform API（新增的 endpoint）

```bash
# Dashboard（dev/demo 環境不需 platform key）
curl https://erp-line-bot.fly.dev/api/platform/dashboard \
  -H "X-Platform-Key: <PLATFORM_ADMIN_KEY>"

# Tenants 列表
curl https://erp-line-bot.fly.dev/api/platform/tenants \
  -H "X-Platform-Key: <PLATFORM_ADMIN_KEY>"

# Versions
curl https://erp-line-bot.fly.dev/api/platform/versions \
  -H "X-Platform-Key: <PLATFORM_ADMIN_KEY>"
```

### 6c. 既有功能迴歸

- 開 LINE Bot 發一則測試訊息，確認 webhook 正常
- 後台 `/admin/` 可登入、看到客戶/產品/訂單列表
- 主控台 `/saas-admin/` 可載入（f552f91 新增）

### 6d. 業績獎金（v2.16.0）

- 後台 → 員工 → 確認可編輯 taxDeductRate 欄位
- 銷貨單 → 確認 SalesItem 有 costAtSale 欄位（新建單據才有值）

## Step 7: 設定 PLATFORM_ADMIN_KEY

如果 production 還沒設定此 secret：

```bash
fly secrets set PLATFORM_ADMIN_KEY="$(openssl rand -hex 32)" -a erp-line-bot
```

記下此 key，後續 CP 的 `.env` 要設定相同值。

## Step 8: Rollback 計畫

若 deploy 後有嚴重問題：

```bash
# 應用層退版（退到上一個 release）
fly releases -a erp-line-bot
fly releases rollback -a erp-line-bot
```

DDL 是新增欄位 + 新增表，向後相容（舊版 code 不讀新欄位），不需要 rollback DDL。

---

## 完成後更新

1. `D:\Claude\Obsidian\Projects\SaaS-Multi-Tenant-Architecture.md` — Timeline 的 `⏳ 待 deploy` 改為 `✅ deployed`
2. 確認 `curl /api/version` 回傳的 version 與 commit

---

> ⚠️ Step 3 ~ Step 4 涉及 production DB 操作，需人工在 Supabase SQL Editor 執行。
> Claude Code 可協助：Step 1 編譯、Step 2 版本 bump、Step 5 fly deploy 指令、Step 6 驗證 curl。
