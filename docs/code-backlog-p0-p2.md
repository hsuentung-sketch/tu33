# Code 執行清單 — P0 ~ P2

> 由 Cowork 2026-05-24 架構比對產出。三個前置決策已簽核：
> 1. **Billing 真相來源 = ERP**（CP 改 read-only 同步）
> 2. **Version = 並存**（CP 管 deploy commit tracking，ERP 管 semver changelog）
> 3. **Dashboard = CP 彙總**（呼叫各 ERP instance `/api/platform/dashboard`）

---

## P0 — 致命缺陷（ERP 產品層）

### P0-2: User.lineUserId 隔離

**現狀**：`lineUserId` 在 Employee 表上可能跨 tenant 重複，auth middleware 查詢未帶 tenantId。

**目標**：
- `Employee` 加 `@@unique([tenantId, lineUserId])` 複合唯一
- auth middleware / LIFF auth 查詢一律帶 tenantId
- Migration 前先掃現有資料有無跨 tenant 重複

**檔案**：
- `prisma/schema.prisma` — Employee model
- `src/modules/core/auth/auth.service.ts`
- `src/modules/core/auth/auth.middleware.ts`
- `src/modules/core/auth/liff-auth.middleware.ts`

**風險**：現有 prod 若有重複 lineUserId 跨 tenant，migration 會失敗。需先寫檢查 script。

---

### P0-3a: Billing 統一（ERP 為主，CP 改 read-only）

**現狀**：
- ERP 有完整 billing schema（`BillingPlan` / `TenantBillingSubscription` / `Invoice` / overdue cron / Stripe webhook placeholder）
- CP 有輕量 `Plan`（SQLite，modules JSON，monthlyFee）+ `Customer.paidUntil` / `lastPaidAt`
- 兩邊資料不同步，各自獨立

**目標**：
- ERP 的 billing 是 single source of truth
- CP 的 `Plan` CRUD 保留（方便營運者快速設定），但**新建客戶時**把 plan 資訊推送到 ERP 的 `BillingPlan` + 建 `TenantBillingSubscription`
- CP 的 mark-paid / suspend / resume 改為：先呼叫 ERP API 更新，再更新本地 SQLite 快取
- ERP 新增 `/api/platform/billing/sync` endpoint 供 CP 呼叫

**檔案**：
- ERP: `src/modules/core/platform/platform.router.ts` — 加 billing sync endpoints
- ERP: `src/modules/core/billing/billing.service.ts` — 加 external sync method
- CP: `src/routes/lifecycle.ts` — mark-paid/suspend 改呼叫 ERP API
- CP: `src/routes/plans.ts` — create/update 後推送到 ERP

**注意**：CP 呼叫 ERP 時需要 `PLATFORM_ADMIN_KEY` + 目標 ERP 的 public URL。CP 的 `Customer.publicUrl` 已有此欄位。

---

### P0-V: Version 管理確認並存

**現狀**：
- CP: `upgrade.ts` 用 git commit SHA 追蹤 drift（`Customer.lastMigratedCommit` vs repo HEAD）
- ERP: `VersionHistory`（semver）+ `VersionUpgradeLog`（tenant 升級紀錄）+ `rollbackVersion`

**目標**：確認兩者用途不同，不合併，但確保欄位可對齊。

**行動**：
- ERP `VersionUpgradeLog` 加 `commitHash String?` 欄位（optional，讓 CP push 時能寫入）
- CP upgrade 成功後，呼叫 ERP `/api/platform/versions/record` 寫入 semver + commit 紀錄
- 目前不需改 CP 的 drift detection 邏輯（已運作正確）

**檔案**：
- ERP: `prisma/schema.prisma` — VersionUpgradeLog 加 commitHash
- ERP: `src/modules/core/platform/platform.router.ts` — 加 version record endpoint
- CP: `src/routes/upgrade.ts` — 升級成功後 POST 到 ERP

---

## P1 — 高優先（ERP 產品層）

### P1-1: Churn 流程（soft-delete + 資料導出）

**目標**：
- `Tenant` 加 `deletedAt DateTime?`，soft-delete 不真刪
- 資料導出 API：`/api/platform/tenants/:id/export`（JSON dump 主要 tables）
- CP suspend 時 fly scale 0，resume 時 fly scale 1（已有）
- 30 天後可 hard-delete（admin 確認）

**檔案**：
- ERP: `prisma/schema.prisma` — Tenant.deletedAt
- ERP: `src/modules/core/tenant/tenant.service.ts` — soft-delete + export
- ERP: `src/modules/core/platform/platform.router.ts` — export endpoint

---

### P1-3: LINE 多租戶隔離驗證

**目標**：確認 webhook handler 的 channelId routing 無串租戶風險。

**檢查點**：
- `src/line/webhook.ts` — 收到 webhook 後用哪個欄位定位 tenant？
- `src/modules/core/auth/liff-auth.middleware.ts` — LIFF id-token 的 channelId 查找邏輯
- 若 LINE Messaging API channel 是 per-tenant，webhook 事件的 `destination` 應對應到唯一 tenant

**檔案**：
- `src/line/webhook.ts`
- `src/line/handlers/index.ts`
- `src/modules/core/auth/liff-auth.middleware.ts`

---

## P2 — 中優先

### P2-fee: Feature gate 與 CP Plan.modules 對齊

**目標**：CP 建客戶選 Plan 時，Plan.modules → ERP seed 的 Tenant.modules 一致。

**行動**：
- CP `seed-tenant.ts` 已從 Plan.modules 讀取，確認與 ERP 的 `BillingPlan.modules` 定義一致
- ERP Feature gate 的 `requireModule` 用的 key 要與 CP template-registry 的 `knownModules[].key` 一致

**檔案**：
- CP: `src/shared/seed-tenant.ts`
- ERP: `src/modules/core/feature/feature.service.ts`
- 對齊文件: `docs/module-keys.md`（需新建，列出所有合法 module key）

---

### P2-dash: CP Dashboard 彙總

**目標**：CP dashboard 從各 ERP instance 的 `/api/platform/dashboard` 拉資料彙總。

**行動**：
- CP `lifecycle.ts /dashboard` 改為：遍歷 active customers，呼叫各自 publicUrl + `/api/platform/dashboard`
- 加 timeout + 失敗容忍（某 instance 離線不影響整體）
- 本地 SQLite 的 revenue 資料改為 cache（非 source of truth）

**檔案**：
- CP: `src/routes/lifecycle.ts`
- CP: 新建 `src/clients/erp-api.ts`（封裝呼叫 ERP API 的 helper）

---

## 執行順序建議

```
P0-2 (User 隔離)        ← 安全，最優先，無依賴
  ↓
P0-V (Version commitHash) ← schema 小改，順手做
  ↓
P0-3a (Billing 統一)     ← 需 ERP + CP 兩邊改，工量最大
  ↓
P1-3 (LINE 隔離驗證)     ← 可能只是 review，不一定要改 code
  ↓
P1-1 (Churn 流程)        ← 依賴 billing 統一後才有意義
  ↓
P2-fee (module key 對齊)  ← 文件 + 小幅驗證
  ↓
P2-dash (CP 彙總)        ← 需 P0-3a 完成（CP 才知道怎麼呼叫 ERP API）
```

---

> 本檔由 Cowork session 產出，帶到 Claude Code 逐項執行。
> 每完成一項，回 Obsidian `SaaS-Multi-Tenant-Architecture.md` 更新 Epic 狀態。
