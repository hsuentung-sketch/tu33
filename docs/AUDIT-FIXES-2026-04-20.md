# 稽核修復 — 2026-04-20

涵蓋 audit 全掃的 20 項。下列分兩類：**影響使用的**（需 action / 有 migration）與 **純內部修改**（push 就生效）。

---

## ⚠ 需要使用者 action 的修改

### A1. JWT_SECRET 強制設定（修 #1）

**影響**：若 Fly 沒設 `JWT_SECRET` secret，服務**開機會 throw**。

**檢查**：
```powershell
fly secrets list | Select-String JWT_SECRET
```

- 已有 → 沒事，直接部署
- **沒有** → 先灌再部署：
  ```powershell
  $secret = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | % {[char]$_})
  fly secrets set JWT_SECRET=$secret
  ```
  這會**立即讓所有現有 session + PDF 短連結失效**（使用者要重新登入、PDF 短連結要重開）。上次稽核結果檢視現有狀態：
  - `fly secrets list` 已顯示 `JWT_SECRET`，**Deployed** → 無需行動

### A2. PUBLIC_BASE_URL 強制設定（修 #4）

**影響**：若沒設，開機 throw。

**檢查**：
```powershell
fly secrets list | Select-String PUBLIC_BASE_URL
```
- 上次已執行 `fly secrets set PUBLIC_BASE_URL=https://erp-line-bot.fly.dev` → **已有，無需行動**

### A3. 單號時區改為 Asia/Taipei（修 #2）

**影響**：
- **舊單據不變**（不做資料回填）
- **新單據**在台北 00:00-08:00 建立時，單號 `YYYYMMDD` 會是台北日期（先前在 UTC，會寫成前一天）
- AR/AP 的 `billingYear/billingMonth` 同樣改為台北日期 → 月結對帳單月份歸屬更準確
- **不會**影響現有月結計算（只影響未來跨午夜的建單）

**Action**：無，部署後自動生效。

### A4. 單號 race 加 P2002 retry（修 #3）

**影響**：
- schema 已有 `@@unique([tenantId, orderNo])` → 以前併發會 500
- 現在會自動重試用下一個序號，使用者無感
- **不需要 schema migration**

**Action**：無。

### A5. 登入 rate limit（修 #20）

**影響**：同一 `(IP, employeeId)` 超過 10 次失敗 / 10 分鐘 → `嘗試次數過多，請 10 分鐘後再試`。正常使用者無感。

**Action**：無。

### A6. 控台加 API token（修 #7）

**影響**：總控台 SPA 第一次載入會**跳出 prompt** 要 token。Token 存在 `.auth-token` 檔（0600 權限，已 gitignore），終端啟動時會印出來。

**Action**：
```powershell
cd D:\Claude\erp-control-plane
npm run dev
```
啟動時終端會顯示：
```
────────────────────────────────────────────────────────────
Local API token (SPA will prompt for this on first load):
  a3f9d2e1c8b4f5a7...（48-hex 字串）
Stored in .auth-token (0600, gitignored).
────────────────────────────────────────────────────────────
```
瀏覽器開 `http://localhost:7000` → 跳 prompt → 貼上 token。
Token 存在 sessionStorage，重開瀏覽器要再貼一次（安全考量）。

---

## 🟢 純內部修改（push 即可）

| # | 修改 | 檔案 |
|---|------|------|
| 5 | 每日備份檔名用台北日期 | `src/jobs/daily-backup.ts` |
| 6 | 銷貨/進貨/報價 confirm 改用 safeSend（reply 30s 過期自動 push） | `src/line/handlers/sales.handler.ts`、`purchase.handler.ts`、新建 `src/line/safe-send.ts` |
| 8 | 控台 GitHub API 加負向快取 + 友善 rate-limit 提示 | `erp-control-plane/src/clients/github-api.ts` |
| 10 | 報價 LINE push 失敗寫進 ErrorLog | `src/modules/sales/quotation/quotation.router.ts` |
| 11 | 移除已過期的 P2022 `createdBy` fallback | `src/modules/master/customer/customer.service.ts`、`src/line/handlers/media.handler.ts` |
| 16 | `reverseInventory` 批次查產品（50 item 從 150 次→51 次 query） | `src/modules/sales/sales-order/sales-order.service.ts` |
| 17 | 備份 `auditLog/errorLog/inventoryTransaction` 只收近 90 天 | `src/jobs/daily-backup.ts` |
| 18 | 控台 `fetchInstanceVersion` timeout 8s→15s | `erp-control-plane/src/clients/erp-instance.ts` |
| 19 | 登入模糊訊息（不洩漏員工存在於多租戶） | `src/modules/core/auth/web-auth.router.ts` |
| — | SSRF 白名單（控台拒絕 internal IP / non-https） | `erp-control-plane/src/clients/erp-instance.ts` |
| — | 控台 graceful shutdown（SIGINT/SIGTERM 釋放 Prisma 連線） | `erp-control-plane/src/index.ts` |
| — | 控台版本頁 graceful degrade（GitHub 掛了仍列 instance） | `erp-control-plane/src/routes/versions.ts`、`public/app.js` |
| — | 移除所有 `onrender.com` / `Render env` 遺留字串 | `src/documents/*`、`src/tools/rotate-line-token.ts` |

---

## 部署步驟

**1. 確認 A1 / A2 secret 有設（只需做一次）**
```powershell
cd D:\Claude\ERP
fly secrets list | Select-String "JWT_SECRET|PUBLIC_BASE_URL"
```
都有 → 跳到 step 2。

**2. Commit + push + deploy**
```powershell
git add src/ docs/ public/admin/manual.md .dockerignore scripts/ Dockerfile
git commit -m "fix: audit sweep — critical timezone/race/auth + reliability

- Taipei timezone for document numbers and AR/AP billing period
- P2002 retry on daily-sequence unique collisions
- JWT_SECRET / PUBLIC_BASE_URL throw-on-missing in production
- safeSend (reply→push fallback) for sales/purchase/quotation confirm
- Login rate limit 10 attempts per 10min per (IP, employeeId)
- Remove obsolete P2022 createdBy fallback hacks
- Batch product lookup in reverseInventory (N+1 → 1)
- Daily backup: Taipei filename; cap log tables to 90 days
- Quotation LINE push failures → ErrorLog
- Misc: sanitize login error msg, update onrender.com references"
git push
.\scripts\fly-deploy.ps1
```

**3. 驗證**
- `curl.exe https://erp-line-bot.fly.dev/health` → 200
- 後台登入 → 版本資訊顯示新 commit
- LINE 建一張測試銷貨單 → 看 PDF 能下載
- 總控台 `http://localhost:7000` → 版本狀態 🟢

**4. 控台**
```powershell
cd D:\Claude\erp-control-plane
# 停掉舊的（Ctrl-C），重起
npm run dev
```
瀏覽器開 → 跳 prompt → 貼終端顯示的 token。

---

## 未做（大型重構，風險高需專門 session）

這五項不是 bug 而是長期維護成本，延後單獨處理：

- **#9 sales/purchase handler 抽 createOrderFlow factory** — 3h，改 570 + 557 行
- **#12 pdf-generator 5 函式合一 renderBusinessDocument** — 3-4h
- **#13 LINE handlers `ctx: any` → 統一 LineCommandContext interface** — 跨 8 檔
- **#14 Router 錯誤處理 split-brain 統一（throw AppError vs res.status().json）** — 跨 15+ 檔
- **#15 admin manual.md 改用 DOMPurify sanitize marked 輸出** — 10 分鐘但要上 CDN 依賴

每一項都要有自己的 feature branch + 測試計畫，不適合跟緊急修補一起來。
