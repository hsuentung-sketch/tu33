# SaaS 總控台 — 架構決策紀錄

> 使用者於 2026-04-20 回答的需求 Q&A。動工前以此為準，若需求改變再更新本檔。

## 定位

單一 code base（ERP LINE Bot）部署到多家公司，每家公司 =
- 自己的 Fly.io app
- 自己的 Supabase project
- 自己的 LINE Messaging + Login channel

總控台用來集中管理所有客戶的**建置**與**版本狀態**。

---

## 決策

### Q1. 總控台自己部署在哪？ → **(b) 本機工具**

只跑在使用者（供應商）電腦上的本機應用。**不上雲**，沒有公開 URL。

實作可能性：
- Electron 桌面 app
- 本機 Node + localhost web UI（`http://localhost:<port>`）

理由：只你自己用 + 要存 Fly / Supabase token，本機最安全。

### Q2. 總控台資料存哪？ → **(a) 獨立 Supabase project**

開一個專屬的 Supabase project（獨立於任何客戶的 DB），存：
- 客戶清單（公司名、聯絡人、合約狀態）
- Fly app 對應（app name、region、建立時間）
- Supabase project 對應（ref、dashboard URL）
- LINE channel 資訊
- 升級紀錄（何時從哪個 commit 升到哪個 commit）

本機工具 + 雲端 DB 的組合：即使換電腦也能接續工作。

### Q3. 誰能登入？ → **(c) 先單人，之後擴充**

V1：寫死一組 email + 密碼（或讀 local env）。
V2：加多帳號 + 角色（之後加內部技術支援同事時再做）。

### Q4. 建置新客戶自動化程度 → **(a) 全自動，但 token 申請 + 輸入由使用者做**

**原則**：
- 需要外部服務 API token（Fly、Supabase）的**申請**由使用者操作（無法程式化）
- 申請完**貼進總控台**一次儲存
- 之後建置流程**全自動**（總控台呼叫 API 執行）
- 需要提供**申請 token 的步驟文件**

**自動化邊界**：
| 步驟 | 誰做 | 備註 |
|------|------|------|
| 建 Supabase project | 使用者去 dashboard 手動（免費版無 Management API） | 總控台提供「下一步」引導 |
| 拿 Supabase URL / service role key | 使用者複製貼到總控台表單 | 表單驗證格式 |
| 建 LINE Messaging channel + Login channel + LIFF | 使用者在 LINE Console 手動 | 總控台提供 checklist |
| 拿 LINE keys + channel IDs | 使用者複製貼到總控台表單 | |
| 建 Fly app | 總控台自動（Fly Machines API） | 需先存 Fly API token |
| 灌 secrets | 總控台自動 | |
| `prisma db push` | 總控台自動（SSH 進 Fly machine 執行） | |
| 跑 bootstrap-tenant | 總控台自動 | |
| Deploy | 總控台自動 | |
| 回填 webhook URL / LIFF endpoint | 使用者在 LINE Console 手動 | 總控台顯示要貼的 URL |

**要另外寫的文件**（給使用者建置新客戶時看）：
- 如何建 Supabase project + 抓 service role key
- 如何建 LINE Messaging channel 與 Login channel
- 如何建 LIFF app
- 如何申請 Fly API token（總控台初次設定要用）

### Q5. 升級功能 → **(b) 只顯示版本，升級靠 push main**

總控台負責：
- 每家客戶列一行：Fly app name / 現在跑的 commit / GitHub main 最新 commit / 落後幾個 commit
- 紅字警示落後太多的 instance

**不做**自動 redeploy 按鈕。

升級流程：
1. 本地開發 → `git push origin main`
2. GitHub Action `.github/workflows/deploy-all.yml` 跑 matrix，對每家 Fly app 執行 `fly deploy`
3. 總控台 GUI 會自動刷新看到新版本

**要另外做的事**：
- 寫 GitHub Action workflow（matrix 列所有客戶 app name）
- 每次新客戶上線要更新 matrix 清單
- Fly API token 要設進 GitHub secrets

### Q6. 客製策略 → **中間地帶 D：共用 main + feature flag / tenant-settings**

**鐵則**：每家公司跑**同一個 main branch 的 code**。

客戶間差異用：
- `Tenant.settings` JSON 欄位存各公司開關 / 參數（稅率、單號前綴、啟用模組）
- Feature flag table `FeatureFlag(tenantId, key, enabled)`
- 模組 enable/disable 走 `Tenant.modules` 陣列（已有）

**禁止**：
- 每家公司開獨立分支 cherry-pick
- 在 code 裡寫 `if (tenantId === 'company-b') { ... }` 特殊處理

**若某家真的有獨特需求**：
- 先思考能否抽象成 config
- 真的做不到 → 進 Tenant.settings 加新欄位，code 依 config 判斷
- 最壞情況：寫成 plugin / strategy pattern，各公司 settings 指定要用哪個 strategy

---

## 下一步（未動工）

當使用者說「開始做 SaaS 總控台」時：

1. 討論 V1 scope（建議：只做「查看現有客戶版本 + 建新客戶」，升級走 GitHub Action）
2. 決定技術棧（Electron vs localhost Node + 瀏覽器）
3. 設計總控台 Supabase schema（Customer / FlyApp / DeployHistory）
4. 寫外部服務申請 token 的 step-by-step docs
5. 實作建置流程的 orchestrator（每個外部 API 呼叫都要 idempotent，失敗要能 resume）
