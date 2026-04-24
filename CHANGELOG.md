# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · semver.

## [2.1.1] - 2026-04-24

### Changed — 後台側欄整合
側欄 17 項收攏成 11 項，透過 tab 呈現：
- **管理**（客戶 / 產品 / 供應商 / 員工）— 員工 tab 僅 ADMIN 可見
- **帳款**（應收 / 應付）
- **發票**（電子發票 / 發票配號）— 配號 tab 僅 ADMIN 可見
- **紀錄**（操作紀錄 / 異常紀錄）— 整組僅 ADMIN 可見

新 hash 格式：`#<group>/<tab>`（例：`#management/products`）。舊 hash（`#customers` / `#receivables` / ...）自動 redirect 到新位置，**書籤不會壞**。各子檢視函式完全沒動，內部操作（新增 / 編輯 / 刪除 / modal / 搜尋 / 下載）行為 100% 維持。

## [2.1.0] - 2026-04-24

### Added — 電子發票（Turnkey 直連，Phase 1）
- 後台應收帳款列表新增「開立發票」按鈕（ADMIN only）：帶入客戶統編／地址／銷貨品項 → 取號 → 產生 MIG 3.2.1 C0401 XML 寫入 Turnkey 匯入目錄
- 新檢視「電子發票」：列出已開立／已上傳／已確認／已作廢，可下載 C0401 / C0501 XML、作廢
- 新檢視「發票配號」（ADMIN）：維護國稅局核定的字軌與配號區間（期別、起號、迄號、剩餘張數、啟用／停用）
- 銷貨單 PDF 自動顯示關聯發票號碼與開立日期；作廢時紅字標註
- 作廢流程：C0501 XML 寫入 Turnkey 目錄，AR 的 `invoiceNo` 快取欄位自動清空
- 回執輪詢 CLI：`npx tsx src/tools/sync-einvoice-status.ts [tenantId]`，掃 `turnkeyOutboundDir` 反寫 status（confirmed / rejected）
- B2B 三聯式（有統編）＋ B2C 二聯式（無統編，XML 以 `0000000000` 輸出）；載具／捐贈碼留待 Phase 2

### Added — 新 Prisma model
- `EinvoiceNumberPool`（tenant scoped，FIFO 取號）
- `Einvoice` + `EinvoiceItem`（與 AR 1:1、與 SalesOrder N:1）

### Changed
- `Tenant.settings.einvoice` 新欄位（JSON，無 DDL）：`enabled / sellerTaxId / sellerName / turnkeyInboundDir / turnkeyOutboundDir / defaultTaxType`
- `requireAdmin` helper 抽到 `src/modules/core/auth/require-admin.ts` 共用
- 銷貨單 PDF 的 `SalesOrderPdfData` 增加可選 `einvoice` 欄位；pdf.router 會抓最近一張未作廢發票塞進去

### Security
- 所有 `/api/einvoices/*`、`/api/einvoice-number-pools/*` 寫入路徑 ADMIN only
- `turnkey-writer` 拒絕相對路徑與不存在的目錄，檔名字串做 alphanumeric 過濾
- 發票號碼一經分配即視為用掉（符合財政部規範），失敗時不回收

### Migration
需於 Supabase SQL Editor 執行：
```sql
-- EinvoiceNumberPool
CREATE TABLE "EinvoiceNumberPool" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "yearMonth"   TEXT NOT NULL,
  "trackAlpha"  TEXT NOT NULL,
  "rangeStart"  INTEGER NOT NULL,
  "rangeEnd"    INTEGER NOT NULL,
  "nextNumber"  INTEGER NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "note"        TEXT,
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EinvoiceNumberPool_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE
);
CREATE INDEX "EinvoiceNumberPool_tenantId_isActive_idx"
  ON "EinvoiceNumberPool"("tenantId","isActive");

-- Einvoice
CREATE TABLE "Einvoice" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "invoiceNo"     TEXT NOT NULL,
  "invoiceDate"   TIMESTAMP(3) NOT NULL,
  "buyerTaxId"    TEXT,
  "buyerName"     TEXT NOT NULL,
  "buyerAddress"  TEXT,
  "salesAmount"   DECIMAL(14,2) NOT NULL,
  "taxAmount"     DECIMAL(14,2) NOT NULL,
  "totalAmount"   DECIMAL(14,2) NOT NULL,
  "taxType"       TEXT NOT NULL DEFAULT '1',
  "status"        TEXT NOT NULL DEFAULT 'issued',
  "voidedAt"      TIMESTAMP(3),
  "voidReason"    TEXT,
  "xmlPath"       TEXT,
  "voidXmlPath"   TEXT,
  "uploadedAt"    TIMESTAMP(3),
  "confirmedAt"   TIMESTAMP(3),
  "rejectReason"  TEXT,
  "receivableId"  TEXT UNIQUE,
  "salesOrderId"  TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Einvoice_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "Einvoice_receivableId_fkey" FOREIGN KEY ("receivableId")
    REFERENCES "AccountReceivable"("id"),
  CONSTRAINT "Einvoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId")
    REFERENCES "SalesOrder"("id")
);
CREATE UNIQUE INDEX "Einvoice_tenantId_invoiceNo_key"
  ON "Einvoice"("tenantId","invoiceNo");
CREATE INDEX "Einvoice_tenantId_status_idx"
  ON "Einvoice"("tenantId","status");
CREATE INDEX "Einvoice_tenantId_invoiceDate_idx"
  ON "Einvoice"("tenantId","invoiceDate");

-- EinvoiceItem
CREATE TABLE "EinvoiceItem" (
  "id"          TEXT PRIMARY KEY,
  "invoiceId"   TEXT NOT NULL,
  "sequence"    INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity"    DECIMAL(14,4) NOT NULL,
  "unit"        TEXT,
  "unitPrice"   DECIMAL(14,4) NOT NULL,
  "amount"      DECIMAL(14,2) NOT NULL,
  CONSTRAINT "EinvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId")
    REFERENCES "Einvoice"("id") ON DELETE CASCADE
);
```

### 風險提醒
- Fly.io 容器 FS 為 ephemeral，本 Phase 1 `turnkey-writer` 先寫本機路徑僅供本機驗證；正式部署請改走 SFTP 或 S3（`turnkey-writer.ts` 的介面保持穩定，換實作不影響 service/router/UI 層）
- 向國稅局申請的「電子發票專用字軌核定通知書」仍需 ADMIN 每兩個月手動把配號區間輸入到「發票配號」頁
- 載具（手機條碼／自然人憑證）、捐贈碼、折讓單（D0401/D0501）為 Phase 2

## [2.0.2] - 2026-04-24

### Added
- 後台員工管理：新增「後台登入」欄位顯示密碼狀態（✅ 已設定 / ❌ 未設定 + 最後設定時間 tooltip）
- 新增 / 編輯員工 modal 加入密碼區塊：ADMIN 可設定、重設、移除密碼（最少 8 碼 + 二次確認）；明文密碼**永不**回傳前端或寫入 log

### Changed
- `Employee` schema 新增 `passwordSetAt DateTime?` 欄位
- `POST /api/employees` 接受 optional `password`；`PUT /api/employees/:id` 接受 `password: string` (重設) 或 `password: null` (移除)
- 密碼欄位僅 ADMIN 可變更（非 ADMIN 傳 password → 403）
- `src/tools/set-password.ts` 同步寫入 `passwordSetAt`

### Security
- 員工列表 / 查詢 API 永不回傳 `passwordHash`；改回傳 `hasPassword: boolean` + `passwordSetAt`

### Migration
需於 Supabase SQL Editor 執行：
```sql
ALTER TABLE "Employee" ADD COLUMN "passwordSetAt" TIMESTAMP(3);
```

## [2.0.1] - 2026-04-23

### Added
- 後台「報價單 / 銷貨單 / 進貨單」列表新增 inline「刪除」按鈕（ADMIN 或建單人可見），呼叫既有的 soft-delete 端點；刪除時連動沖銷對應 AR/AP 與庫存異動，已結案 AR/AP 由後端拒絕

## [2.0.0] - 2026-04-21 — 正式上線

### Milestone
第一版正式版本 — 離開測試階段。

### Added
- PDF 品項表固定 5 列（報價 / 銷貨 / 進貨），不足補空白、超過照實列，三單視覺一致
- `src/tools/reset-transactions.ts` — 清除交易資料但保留 tenant / 員工 / 主檔的重置工具
- `src/tools/import-transactions.ts` — 從 Excel 匯入銷貨/進貨紀錄，並自動生成對應 AR/AP
- 後台「使用說明」手冊綁定 `/api/version`：`manual.md` 使用 `{{APP_VERSION}}` / `{{APP_COMMIT}}` / `{{APP_DEPLOYED_AT}}` placeholder，render 時自動 inject 當前部署版本；新增 CHANGELOG 連結

### Changed
- 版本號 1.0.1 → 2.0.0（正式上線里程碑，非破壞性變更）

### Data
- 清除所有測試交易資料：15 銷貨單 / 4 進貨單 / 12 報價 / 13 AR / 4 AP / 54 審計 / 9 錯誤 / 20 短連結 全部刪除
- 保留：1 tenant、2 員工、34 產品、6 客戶、2 供應商

## [1.0.1] - 2026-04-20

### Fixed — Security / Correctness
- `JWT_SECRET` 與 `PUBLIC_BASE_URL` 在 production 缺失時改為 boot-time throw（不再 silent fallback）
- 單號 race：`@@unique([tenantId, orderNo])` 並發碰撞改用 P2002 retry 取下一序號
- 登入加 rate limit（10 次 / 10 分鐘 per IP+employeeId）
- 登入多租戶模糊訊息（不再洩漏員工存在於哪些租戶）
- 移除已過期 P2022 `createdBy` fallback（schema 已補齊）

### Changed — Taipei timezone semantics
- 單號 `YYYYMMDD` 改用台北日期（先前在 UTC，台北 00:00–08:00 建單會寫成前一天）
- AR/AP `billingYear/billingMonth` 改用台北日期（月結月份歸屬更準）
- 每日備份檔名用台北日期

### Fixed — Reliability
- 銷貨/進貨/報價 confirm 改用 `safeSend`（reply 30s 過期自動 push）
- 報價 LINE push 失敗寫入 `ErrorLog`
- `reverseInventory` 批次查產品（50 item 從 150 次 → 51 次 query）
- 每日備份 `auditLog/errorLog/inventoryTransaction` 只收近 90 天

### Added — Control plane 協作
- `Dockerfile` / `GIT_COMMIT` build arg → `/api/version` 真實回報 commit（控台用來比對是否落後 main）
- `scripts/fly-deploy.ps1` 包裝 `fly deploy --build-arg GIT_COMMIT=<sha>`
- `.github/workflows/fly-deploy.yml` 自動 deploy（需 GitHub secret `FLY_API_TOKEN`）

### Removed
- 所有 `onrender.com` / `RENDER_GIT_COMMIT` 遺留字串（搬至 Fly 後不再使用）

詳細清單與使用者 action 步驟：`docs/AUDIT-FIXES-2026-04-20.md`

## [1.0.0] - 2026-04-19

### Added
- 初始從 Render 搬遷至 Fly.io (`erp-line-bot.fly.dev`, region `nrt`)
- Multi-stage Dockerfile + `fly.toml` (min_machines_running=1, auto_stop=off)
- LIFF 報價單表單 + `/api/me`
- LINE chat 產品 Flex Carousel 搜尋
- 名片 OCR（Google Vision）
- 員工 LINE 綁定碼（LINE chat + CLI + 後台）
- 後台管理介面 Phase 1（bcryptjs + cookie session，11 個檢視）
- 公開 PDF 短連結（JWT 簽名，7 天 TTL）
- `/api/version` endpoint
