# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · semver.

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
