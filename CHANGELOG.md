# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · semver.

## [2.7.5] - 2026-05-05

### Added — LINE chat 新增傳票（拍照辨識 / 手動輸入）
ADMIN/ACCOUNTING 從 LINE「帳務」選單進入「➕ 新增傳票」，兩條路徑最終都對接後端 `expense.service.quickExpense` 自動產 JE。

#### 流程
- 「帳務」選單 → 「➕ 新增傳票」按鈕（僅 ADMIN/ACCOUNTING 可見）
- 選方式：📸 拍照辨識 / ✍️ 手動輸入
- **拍照辨識**：上傳發票照片 → Google Vision OCR → regex 抽 (商家名 / 金額 / 日期 / 統編 / 發票號) → 自動填入 description + amount + voucherNo + date
- **手動輸入**：逐步問 用途說明 → 金額 → 付款方式
- 兩條路徑共用：付款方式（現金 1101 / 銀行 1111 / 應付帳款 2101） → 確認預覽（含自動推論的會計科目）→ 送出
- 確認前可隨時輸入「修改用途 XXX」覆蓋自動辨識結果，會重新跑科目推論
- ADMIN 可在確認前切「直接過帳」/「待審核」；ACCOUNTING 強制 pending

#### 新增檔案
- `src/ai/invoice-ocr.ts` — 發票 OCR：用既有 `GOOGLE_VISION_API_KEY`，regex 抽 5 個欄位
  - 金額：搜「總計/合計/應付」附近數字 → fallback 取 `$/NT$ NNN` 最大值
  - 日期：西元 / 民國 / 中華民國 X 年 X 月 X 日 三種格式
  - 發票號：`AB12345678`（兩碼英文+8 碼數字）
  - 商家名：含「公司/超商/工坊/商行/實業」等關鍵字優先；fallback 第一行
  - 統編：「統一編號 / 統編」標記優先；fallback 任意 8 碼數字
- `src/line/handlers/je.handler.ts` — 完整對話流程（postback / text / image 三入口），含 safeSend reply→push fallback

#### 修改
- `src/line/session.ts`：新增 `flow='je:create'` 與 6 個 step；`data.jeDraft` 草稿欄位
- `src/line/handlers/accounting.handler.ts`：`accounting:menu` 對 ADMIN/ACCOUNTING 多送一張「新增傳票」按鈕卡（避開 LINE buttons template 4-action 上限）
- `src/line/handlers/index.ts`：image dispatcher 先檢查 JE session，是 `je-ocr-wait-image` 才走發票 OCR；否則保持原本名片 OCR 行為。postback router 加 `je:` 前綴。text router 加 `handleJeText` 分支

#### 失敗處理
- 無 `GOOGLE_VISION_API_KEY` → 自動 fallback 手動輸入路徑
- OCR 抽不到金額 → 進 `je-amount` step 由使用者補（其他欄位保留）
- OCR 抽不到商家 → 進 `je-describe` step
- 後端會計模組未啟用 / 期間關閉 → service 錯訊原文回 LINE

#### 對接後端（未動既有 API）
- POST `/api/accounting/expense/quick`（v2.7.2 已有）
- `previewExpenseAccount(description)` 用於每步即時顯示判斷結果

## [2.7.4] - 2026-05-05

### Fixed — 公司名 / 電子發票賣方資訊單一資料來源（修使用者誤填污染）
原本 PDF 抬頭與電子發票 XML `<Seller>` 區塊允許 `settings` 欄位 override：
- `settings.companyHeader` 蓋過 `Tenant.companyName`
- `settings.einvoice.sellerName/sellerTaxId/sellerAddress` 蓋過 `Tenant.*`

實際資料庫巡檢發現該租戶設定被誤填成**客戶**資料（sellerTaxId 寫成客戶宏茂的統編 80096772），
若不修，**開立電子發票上傳會被財政部拒收**。

#### 後端：移除 override，固定取自「公司資料」
- `src/routes/pdf.router.ts`：`companyHeader = tenant.companyName`（原 `settings.companyHeader || tenant.companyName`）
- `src/jobs/monthly-statement.ts`：同上
- `src/line/handlers/quotation.handler.ts`：同上
- `src/modules/accounting/einvoice/einvoice.service.ts`：
  - `sellerTaxId = tenant.taxId`（原 `einvCfg.sellerTaxId || tenant.taxId`）
  - `sellerName = tenant.companyName`
  - `sellerAddress = tenant.address`
- `src/modules/accounting/einvoice/einvoice.router.ts`（B2C 證明聯 PDF）：同步硬編

#### 後端：擋住未來重新污染
- `tenant.router.ts` `PUT /me/einvoice-settings` 接到 `sellerTaxId/sellerName/sellerAddress` 一律忽略 + 強制清空 DB 殘值

#### 前端：移除賣方三欄位輸入
- `public/admin/app.js` 公司資料頁 → 電子發票設定區塊：刪除「賣方統編 / 賣方名稱 / 賣方地址」三個 input
- 取代為唯讀提示卡：「賣方資訊一律取自上方『公司資料』」

#### 資料修復工具
- `src/tools/fix-tenant-settings-pollution.ts`：
  - 預設 dry-run 列出所有 tenant 內髒掉的 `companyHeader` / `einvoice.seller*`
  - `--apply` 旗標實際清除（companyHeader 移除 key、einvoice.seller* 設空字串）
- 已對潤樋租戶執行 `--apply`，清掉以下污染：
  - `companyHeader="潤樋實業股份有限公司"`（不正確全名 → 移除）
  - `einvoice.sellerTaxId="80096772"`（客戶統編 → 清空）
  - `einvoice.sellerName="宏茂事業股份有限公司"`（客戶名 → 清空）
- 結果：PDF 抬頭與電子發票 XML 賣方一律顯示 `潤樋實業有限公司` / `62198132` / `苗栗縣頭份市中正一路32號1F`

#### 巡檢工具
- `src/tools/check-company-name.ts`：列出每個 tenant 的 `companyName` / `taxId` / `address` / `settings.companyHeader` / `settings.einvoice.seller*` 與「PDF 實際顯示」結果，方便日後快速對帳

### Note
- **若公司正名有變動 → 改 Tenant.companyName**（後台「公司資料」），不要再用 settings override
- 若有分公司另用字軌需求（極少數情境），未來透過 v2.6.0 預留的 `branchId` 欄位處理

## [2.7.3] - 2026-05-05

### Fixed — PDF 文字超出欄位自動換行（修月結請款單地址被截斷）
共用 `drawInfoGrid` / `drawItemTable` 之前用固定 `rowH=24` 並對 item table 加 `ellipsis:true`，
長地址或長品名會被截字。改為 **量測 → 動態列高 → 自動換行**：

- `drawInfoGrid`：對每列左右兩欄 value 預先 `doc.heightOfString(val, {width})`，
  取大者 + 上下 padding，最少 24pt。多列時每列獨立計算。
  - 影響：報價單 / 銷貨單 / 進貨單 / 月結請款單 / 月結應付對帳單的雙欄資訊區塊
- `drawItemTable`：移除 `ellipsis:true` + `height:rowH-4`，改成預先量測每 row max cell 高度，
  動態決定該 row 列高。
  - 影響：所有單據的品項表
- 短文字（< 一行）視覺不變；只有真的會超出寬度時才會撐高列高

### Note
- 列高動態化後，**整張 PDF 高度可能變動**；若觸發換頁需注意 totals/footer 位置（目前所有單據用 absolute Y, 仍在 A4 內）

## [2.7.2] - 2026-05-05

### Added — 會計模組 Phase A：快速費用登記 + 零用金調撥
ADMIN/ACCOUNTING 不必再手動填借貸欄位產傳票；日常費用透過簡化 UI 自動產 JE。

#### 後端 — 新模組 `src/modules/accounting/expense/`
- `expense.service.ts`：
  - **`inferExpenseAccount(desc)`**：依「用途說明」關鍵字自動推論費用科目
    - 6101 薪資 / 6201 租金 / 6211 水電瓦斯 / 6221 文具 / 6231 交通 / 6241 郵電
    - 命中關鍵字優先；皆無命中 → 6291 雜項
    - 該 code 不存在或停用 → fallback 到 6291
  - **`quickExpense()`**：產 `Dr <費用> / Cr <付款帳戶>` JE
    - 付款方式：現金 (1101) / 銀行存款 (1111) / 應付帳款 (2101)
    - 預設 status='pending'，ADMIN 可選 'posted' 直接過帳
    - 可手動指定 expenseAccountId 覆蓋自動推論（會擋非 expense/cost 類）
    - source='expense'，sourceId 存收據/憑證號
  - **`pettyCashTransfer()`**：零用金 ↔ 銀行兩向調撥
    - withdraw：`Dr 1101 / Cr 1111`（從銀行提現補零用金）
    - deposit：`Dr 1111 / Cr 1101`（零用金繳回銀行）
    - source='petty_cash'，自動 status='posted'
- `expense.router.ts`：4 個 endpoint 掛在 `/api/accounting/expense`
  - `POST /quick`、`POST /petty-cash`
  - `GET /preview?description=...`（live preview，不建任何資料）
  - `GET /rules`（公開關鍵字規則表）
- 角色：沿用 accountingRouter 的 ACCOUNTING+ guard（無新增權限層）

#### 前端 — 「會計 → 傳票」頁
- 工具列加 2 顆按鈕：「＋快速費用登記」/「零用金調撥」
- **快速費用登記 modal**：
  - 日期 / 用途說明 / 金額 / 付款方式（radio）/ 憑證號 / 過帳狀態
  - 使用者邊打描述邊 debounce 250ms 呼叫 `/expense/preview`，即時顯示「`6231 交通`（命中關鍵字：計程車）」
  - `<details>` 摺疊區「手動指定」可下拉覆蓋自動判斷（顯示所有啟用中 expense + cost 科目）
- **零用金調撥 modal**：
  - 方向（撥補 / 繳回）/ 金額 / 說明
  - 動態提示對應的 Dr/Cr 分錄

#### Note
- 不影響任何 schema；複用既有 JournalEntry / JournalLine
- 不依賴自動分錄 hook（user 仍未通知正式啟用銷貨/進貨 auto-JE）
- Phase B 留：薪資代扣明細、零用金 imprest 模式、員工借支、JE 模板系統

## [2.7.1] - 2026-05-05

### Added — 會計科目表 Phase A：新增 / 編輯 / 停用 / 刪除（後台 UI）
後端 CRUD 在 v2.5.0 已完成（service + router），本版補上後台介面。

- 「會計 → 科目表」頁加 ADMIN 工具列：「＋新增科目」按鈕
- 表格行尾加動作欄：
  - **編輯**：可改名稱 / 描述 / 啟用狀態
  - **停用 / 啟用** 切換按鈕
  - **刪除**：僅非系統科目顯示；service 層另擋「已被傳票引用」
- 新增 modal：
  - 編號（4 位數字驗證）
  - 名稱
  - 類型（6 選 1：資產/負債/權益/收入/成本/費用）
  - **正常餘額自動推導**（`asset/cost/expense`=借；`liability/equity/income`=貸）
  - 上層科目（可空，若選必須與本科目同類型，level=2）
  - 描述
- 系統科目（`isSystem=true`）UI 上隱藏「刪除」按鈕；service 層也保護
- 「狀態」欄位用顏色區分（啟用綠 / 停用灰）

## [2.7.0] - 2026-05-05

### Changed — XML 規格升級至 **MIG 4.1**（Turnkey v3.2+ 必需）
財政部 114-12-16 強制 MIG 4.1，舊版 Turnkey + MIG 3.2.1 將無法上傳。本版完成升級。

#### XML namespace（5 種訊息全升）
- C0401 / C0501 / D0401 / D0501 / C0701 從 `:3.2` → `:4.1`

#### C0401 新增欄位
- `MainRemark` (Main, 0..1, ≤200 字)：總備註
- `CustomsClearanceMark` (Main, 0..1, "1" 非經海關 / "2" 經海關)：零稅率時必填
- `ZeroTaxRateReason` (Main, 0..1)：零稅率原因
- `ProductItem.TaxType` (1)：每品項稅別（支援混合稅率，預設沿用全發票 taxType）
- `ProductItem.Remark` (0..1)：品項備註
- `RandomNumber` 改為非必填（M → O），仍保留 4 碼產生
- 新增 taxType `"4"`：應稅(特種稅率)

#### Schema 變更
- `Einvoice` 加：`mainRemark` / `customsClearanceMark` / `zeroTaxRateReason` 三欄位（皆可為 null）
- 已透過 `npx prisma db push` 套用至 Supabase
- Migration SQL：
  ```sql
  ALTER TABLE "Einvoice" ADD COLUMN "mainRemark" TEXT;
  ALTER TABLE "Einvoice" ADD COLUMN "customsClearanceMark" TEXT;
  ALTER TABLE "Einvoice" ADD COLUMN "zeroTaxRateReason" TEXT;
  ```

#### Service 強化
- `issue()` 在 taxType=2 時強制要求 `customsClearanceMark`，否則 throw
- 新欄位寫入 DB + 傳遞給 `buildC0401`

#### Router schema
- `taxType` enum 加 `"4"`
- 新增 `mainRemark` (max 200) / `customsClearanceMark` enum / `zeroTaxRateReason` (max 60)

#### Admin UI（後台 AR 頁「開立電子發票」modal）
- 加「課稅別」下拉（4 選項）
- 零稅率時動態顯示「通關方式」+「零稅率原因」欄位
- 加「總備註 MainRemark」欄位（200 字內）

#### 折讓單（D0401 / D0501）
- AllowanceType 已硬編 `"1"`（賣方開立），符合 MIG 4.1「僅賣方可開立」要求
- 不需額外改動

### Note
- **過渡相容**：新 XML 用 `:4.1` namespace，Turnkey v3.2+ 可解；舊版 Turnkey 會拒絕（這正是升級目的）
- 升級後必須使用 **Turnkey v3.2.1+**；舊 Turnkey 拒收
- Turnkey 安裝在公司本地主機，不在這台 Fly server（Fly ↔ 公司主機之間檔案同步另議）
- ADMIN 開立發票時若選零稅率，UI 強制要填通關方式

## [2.6.0] - 2026-05-05

### Changed — 電子發票合規修補（依財政部「自行檢測表」P0 + P1 + P2 全項目）

#### P1-1：交易時間 vs 期別檢核（項 2(2)）
- `allocateNumber()` 改吃 `invoiceDate` 參數，依該日期推算 `periodOfDate(d)` (7 碼) 過濾 pool；
  pool.yearMonth 不符當期一律拒發，錯訊明確指出該期別代號
- 新增 `export periodOfDate(d)` 給 boot-check 重用

#### Extra：C0501 跨期作廢檢核
- `voidInvoice()` 在送 C0501 前比對發票期別 vs 作廢日期期別；跨期 throw「跨期作廢請改用折讓單」

#### P1-2：CSV 配號匯入（項 1(1)）
- 新增 `POST /api/einvoice-number-pools/import-csv`（multipart `file` 欄位，1MB 上限，ADMIN）
- service `importPoolsCsv()` 容忍中/英欄位命名（期別/年期別/yearMonth/InvoiceYearMonth、字軌/字軌號碼/track、起號/迄號/訖號），自動 strip UTF-8 BOM；單列錯誤計數但不中斷
- 後台「發票配號」頁加「匯入 CSV」按鈕，回傳 inserted/skipped/errors 統計

#### P1-3：漏傳補傳 cron（項 10）
- 新增 `src/jobs/einvoice-sync.ts`：每天台北時間 02:30 跑
  1. `syncAllTenants()` 拉 outbound 回執更新 issued → confirmed/rejected
  2. 找 status='issued' 且 createdAt < now-24h 的發票，從 `xmlPath` 讀回 XML 重寫到 inbound（檔名加 `_retry-<ts>` 後綴）
- 在 `src/index.ts` listen 後 `scheduleEinvoiceSync()`

#### P2-1：開機自我檢測（項 3）
- 新增 `src/jobs/einvoice-boot-check.ts`，服務啟動時跑：
  - 對時：fetch `worldtimeapi.org/Asia/Taipei`，本機時鐘偏移 > 5s 警告、> 60s 錯誤
  - 賣方統編 8 碼驗證
  - 至少一筆 active pool；當期至少一筆可用配號
  - 前次 invoiceNo 是否一致於 `pool.nextNumber`
  - production 強制檢查 qrAesKey 32 碼 hex
- 任何缺漏只 log warn，不阻擋啟動

#### P2-2：XML 二份備份（項 11）
- `Einvoice` 加 `xmlBody String? @db.Text` / `voidXmlBody String? @db.Text`
- `issue()` / `voidInvoice()` 寫入 inbound 同時把 XML 內容存 DB
- `readXml()` 優先讀 DB `xmlBody`，fallback 到磁碟 `xmlPath`（Turnkey 主機毀損仍可重建）

#### P2-3：分店字軌欄位
- `EinvoiceNumberPool.branchId String?`（無 FK，純字串欄位）+ `@@index([tenantId, yearMonth, branchId])`
- `Einvoice.branchId String?`（同上）
- 暫不開 UI；待 Branch model 確立後再串
- 預設 null = 總公司共用

### Changed — 電子發票合規修補（依財政部「自行檢測表」P0 項目）
- **項 5（字軌年期別）**：`EinvoiceNumberPool.yearMonth` 由 5 碼改為 **7 碼** —— 民國年 3 + 單月 2 + 雙月 2（如 `1131112` = 113 年 11-12 月期）
  - service `createPool` 加嚴：必須 `^\d{7}$` 且月份組合合法（單月 1/3/5/7/9/11、雙月 = 單月+1）
  - admin UI placeholder 同步更新
  - **DB migration 提示**：若已有 5 碼資料需手動 backfill，例 `'11311'` → `'1131112'`：
    ```sql
    UPDATE "EinvoiceNumberPool"
    SET "yearMonth" = LEFT("yearMonth", 3)
                    || LPAD((CAST(SUBSTRING("yearMonth", 4) AS INT) * 2 - 1)::text, 2, '0')
                    || LPAD((CAST(SUBSTRING("yearMonth", 4) AS INT) * 2)::text, 2, '0')
    WHERE LENGTH("yearMonth") = 5;
    ```
    （目前正式環境尚無資料，可略過）

### Added — B2B 證明聯補齊一維/二維條碼（項 8(3)(6)(7)(8)）
- B2B PDF（`einvoice-b2b-pdf.ts`）在「中文大寫」與「三欄並排」之間新增證明聯條碼區：
  - **左半**：Code 39 一維條碼（期別 + 字軌號碼 + 隨機碼，共 19 字）
  - **右半**：左 QR（含 AES-128 加密驗證碼 + 首品項）+ 右 QR（剩餘品項）
  - 兩 QR 各 70×70pt，一維條碼自適應寬度
- B2B PDF data 介面新增 `aesKeyHex?: string` 欄位；router 自動帶入 `settings.einvoice.qrAesKey`

### Security — QR 加密金鑰強制（項 8(8)）
- `einvoice.service.issue()` 在 `NODE_ENV=production` 時強制檢查 `settings.einvoice.qrAesKey`：
  - 必填，且須為 32 碼 hex（AES-128 / 16 bytes）
  - 缺失或格式錯誤直接 throw，**不再 fallback 到 stub key**
- `proof-barcodes.aesKey()` 在 production 仍走到 stub 時 console.warn 一次（雙保險）
- 開發環境保留 stub 路徑以利本地測試

### Note
- 升級後 ADMIN 須至「公司資料 → 電子發票設定」填入整合服務平台下發的 32 碼 AES 金鑰，否則正式環境開立會被擋
- 後台「發票配號」頁可改用「匯入 CSV」一次帶入整期配號

### Migration (Supabase / 已透過 `npx prisma db push` 套用)
```sql
ALTER TABLE "EinvoiceNumberPool" ADD COLUMN "branchId" TEXT;
CREATE INDEX "EinvoiceNumberPool_tenantId_yearMonth_branchId_idx"
  ON "EinvoiceNumberPool"("tenantId", "yearMonth", "branchId");

ALTER TABLE "Einvoice" ADD COLUMN "xmlBody" TEXT;
ALTER TABLE "Einvoice" ADD COLUMN "voidXmlBody" TEXT;
ALTER TABLE "Einvoice" ADD COLUMN "branchId" TEXT;
```

## [2.5.1] - 2026-05-01

### Fixed
- 後台首頁卡在「載入中…」：v2.5.0 在 app.js 重複宣告 `fmtMoney` 觸發 SyntaxError 導致整個 admin SPA 無法 parse；移除重複宣告，沿用全域 fmtMoney（line 45）

## [2.5.0] - 2026-04-30

### Added — 會計模組 Phase A 基礎建設（預設關閉）
- 新 4 個 model：`ChartOfAccount` / `FiscalPeriod` / `JournalEntry` / `JournalLine`（已 push 至 Supabase）
- 新增 30+ 預設科目範本（台灣中小企業常用，含資產/負債/權益/收入/成本/費用六大類）
- 啟用流程：ADMIN 在「會計 → 總覽」按「啟用會計模組」即觸發：
  1. 種子預設科目
  2. 建立會計年度 12 期間
  3. flip `Tenant.settings.accounting.enabled`
- 啟用後可建立期初餘額（單筆開帳分錄，預設範本：現金 500,000 / 業主資本 500,000）
- 後台側欄新增「會計」分頁，含 7 個子頁：總覽 / 科目表 / 會計期間 / 傳票 / 試算表 / 損益表 / 資產負債表
- 傳票生命週期：pending → posted → reversed；借貸平衡檢核
- 期間 close / reopen（ADMIN）；關閉的期間不可再過帳
- 三大基本報表：試算表（含借貸平衡檢核）、損益表（毛利、淨利）、資產負債表（含本期累計淨利）
- API：`/api/accounting/{status,activate,opening-balance,coa,periods,journal,reports/*}`，需 ACCOUNTING+ 角色

### Note
- 自動分錄 hook（從銷貨/進貨/收付款/發票觸發產 JE）尚未掛上，**啟用後不會自動產生任何分錄**
- 啟用前 Tenant.settings.accounting.enabled = false，所有功能擋在「未啟用」提示頁
- 待用戶通知正式啟用，再加自動分錄 hook（Phase A2）

## [2.4.2] - 2026-04-30

### Changed — B2B 證明聯細節調整
- 紙張改為 **B5**（498.9×708.66pt）
- 公司名 13→**15pt**（+2pt）；「電子發票證明聯」15→**11pt**（-4pt）
- 日期 / 期別改用**西元年**（115-04-30 → 2026-04-30；115年3-4月 → 2026年3-4月）
- 營業稅勾選列：未選中的「零稅率」「免稅」**不再顯示 X 框**（改為純文字標籤），選中項顯示 `✓`
- 底部版面三欄並排：**備註 / 賣方資訊 / 發票章** 在同一列；備註自動帶「出貨單號 + 提醒文字」

## [2.4.1] - 2026-04-30

### Changed — 排版微調 + B2B 證明聯改善
- 報價／銷貨／進貨抬頭 18→**20pt**、公司名 16→**18pt**
- 報價單品項表「編號」欄位加寬 6→**8 份**（不再被擠成兩行）
- info grid label 寬 70→**54pt**（公司／聯絡人／地址 與資料間距縮短）
- 表頭（編號／品項／數量／單價／金額／備註）強制**置中**對齊（不再依 column body 對齊跑掉）
- B2B 證明聯紙張改為 PDFKit 標準 **A5**（419.53×595.28pt，半張 A4）
- B2B 證明聯**賣方資訊以 `tenant.companyName / tenant.taxId / tenant.address` 為主**，不再被 `einvoice.sellerName` 等覆蓋（避免測試殘留資料汙染證明聯）
- B2B 證明聯新增**備註框**：自動帶入「出貨單號：xxx」+ 固定文字「發票內容若有誤，請於當月更正，隔月恕不受理。」（從賣方框移除出貨單號欄）

## [2.4.0] - 2026-04-30

### Added — 發票章 + B2B 電子發票格式
- 公司基本資料新增「發票章」上傳區（PNG，≤ 2MB，存 Fly volume `/data/stamps/<tenantId>.png`）
- 報價單 PDF 右下角自動蓋發票章（半透明，預設 0.85；可在後台調整）
- 電子發票證明聯依買方統編自動分派：
  - **B2C**（無統編 / 載具 / 捐贈）：保留 80mm 熱感紙樣式（barcode + dual QR + AES）
  - **B2B**（有 8 碼統編）：A5 直式新格式，含買方框 / 應稅·零稅率·免稅勾選列 / 中文大寫金額 / 賣方框 + 蓋章區
- API：`POST /api/tenant/me/invoice-stamp`（multipart）、`GET /api/tenant/me/invoice-stamp/image`、`DELETE`、`GET /me/invoice-stamp`（settings）

### Changed — PDF 字體放大
- 報價單 / 銷貨單 / 進貨單 / 月結請款單 / 月結對帳單 body 統一 12pt（原 9–10pt），表頭抬頭 18pt 與公司名 16pt 不變
- info grid 行高 20→24、品項表 row 20→24、總計表 20→24，row 高度跟著放大

## [2.3.3] - 2026-04-26

### Fixed
- 根網址 `/` 改為 302 redirect 到 `/admin/`，書籤連到 fly.dev 不再出現「Cannot GET /」

## [2.3.2] - 2026-04-26

### Changed — 後台 SALES 角色再收緊
- 應收帳款：SALES 唯讀。`POST /:id/pay`、`PUT /:id`、`POST /:id/einvoice` 全擋（403）；UI 隱藏「編輯」「標記已付」按鈕（保留查看 + 不變的開立發票按鈕對 SALES 本來就因 ADMIN-only 隱藏）
- 應付帳款：SALES 完全擋。`payable.router` 全擋（403）；UI 帳款 tab 對 SALES 隱藏「應付帳款」
- 產品清單：SALES 看不到進貨成本。`product.router` GET 對 SALES 過濾掉 `costPrice` 欄位後才回（list / search / by-id 都做）；UI 不渲染進價欄位

## [2.3.1] - 2026-04-26

### Changed — LINE chat 業務權限調整
- 管理選單：SALES 不再看到「供應商管理」按鈕；點 `management:supplier*` 任何子動作都回「⛔ 業務無供應商存取權」
- `查詢 xxx` 綜合搜尋：SALES 不再回供應商區塊（仍可查客戶／產品）
- 帳務選單：SALES 只看到「應收 - 未收款 / 應收 - 逾期」兩顆；應付按鈕全隱藏，直接 postback `accounting:ap-*` 也回「⛔」
- 報價選單：移除「追蹤中」按鈕；`quotation:tracking` action 廢止（合併到 `quotation:list`）
- 報價最近列表：take 由 5 → 10，標題顯示「📋 最近 10 筆報價」；SALES 只列自己建的
- 對非 SALES 角色：完全沒有行為改變

## [2.3.0] - 2026-04-25

### Changed — SALES 角色權限收緊

| 區塊 | SALES 之前 | SALES 之後 |
|---|---|---|
| 客戶 | 看全部、改全部 | 看全部；改／刪只限 `createdBy === 自己` 或 `createdBy IS NULL`，違反回 403「沒權限」 |
| 產品 | 任何人都能寫 | 唯讀：POST/PUT/DELETE 回 403 |
| 供應商 | 開放 | 整個 router 全擋（403），側欄管理 ▸ 供應商 tab 隱藏 |
| 報價單 | 看全部、改自己 | 列表只回自己建的（`createdBy` filter），單筆 GET 對非自己回 403 |
| 銷貨單 | 看全部、改自己、刪自己 | 列表只回自己建的；GET 對非自己回 403；DELETE 全擋（403） |
| 進貨單 | 開放 | router 全擋（403）；側欄「進貨單」隱藏 |
| LINE chat 進貨 | 開放 | postback `purchase:*` 與文字「進貨」回「⛔ 業務無進貨權限」 |
| LINE chat 銷貨／報價／帳務／管理 | 維持 | 維持 |

### Frontend
- 側欄 `data-deny-sales` 屬性新增於「進貨單」，SALES 載入時自動隱藏
- GROUPS tab 新增 `denySales: true` flag（供應商 tab）；`visibleTabs()` 同時過濾 `adminOnly` 與 `denySales`
- 產品頁標題副字依角色變動；SALES 隱藏「+ 新增產品」、每列「編輯」「停用」按鈕（保留「文件」）
- 銷貨單列「刪除」按鈕對 SALES 隱藏（編輯仍可，僅自己建的）
- 後端強制檢查為主，UI 隱藏只是清爽顯示

### Implementation Notes
- `customer.service.ts` 加 `canSalesAccessCustomer()` helper（自己或 createdBy null）
- 各 router 採局部 middleware：產品 `blockSales`、供應商／進貨單 router-level `if SALES → 403`、銷貨單 DELETE 加 inline 檢查
- `quotation.service.ts` / `sales-order.service.ts` `list()` 接受 `createdBy` filter
- LINE handler 在 postback dispatcher 與文字命令分支點都加 SALES 檢查；TextCommandContext 員工型別加上 `role`

## [2.2.0] - 2026-04-25

### Added — 電子發票 Phase 2（載具／捐贈／折讓／證明聯 PDF）

**C0401 擴充（開立）**
- 載具欄位：手機條碼 `3J0002`（`/XXXXXXX` 8 碼）/ 自然人憑證 `CQ0001`（2 英文 + 14 數字）/ 會員載具 `EJ0113`
- 捐贈碼 NPOBAN（3-7 碼愛心碼），與載具擇一
- 隨機碼自動產生（4 碼），寫入 `Einvoice.randomCode`
- 列印註記 `printFlag`：載具／捐贈時預設 `N`，否則取 tenant 預設
- B2B（有統編）禁止載具／捐贈；載具與捐贈碼不可同時存在（全部 service 層驗證）

**D0401 / D0501 折讓單**
- 新 Prisma model `EinvoiceAllowance` + `EinvoiceAllowanceItem`
- 新 service `allowance.service.ts`：`issueAllowance` / `voidAllowance` / `listAllowances` / `getAllowance` / `readAllowanceXml`
- 新 router `/api/einvoice-allowances`：GET / / GET /:id / GET /:id/xml / POST /issue / POST /:id/void（寫入動作 ADMIN only）
- 後台電子發票列表新增「折讓」按鈕 → modal 輸入各品項折讓數量 → 自動寫 D0401 XML 至 Turnkey inbound

**C0701 空白字軌月報**
- 新工具 `src/tools/report-blank-numbers.ts`：掃所有 pool，把 `nextNumber .. rangeEnd` 產生 C0701 XML 寫入 Turnkey inbound
- 用途：期末 10 日內向平台回報未使用字軌（補充說明第 2 項）

**電子發票證明聯 PDF**
- 新模組 `proof-barcodes.ts`：Code 39 一維條碼（`期別+號碼+隨機碼`）＋左右 QR 2D 碼
- AES-128-CBC 加密驗證碼（24 碼 Base64）：正式金鑰由整合平台下發；未設定時 fallback 用 `sha256('stub:'+sellerTaxId)` 前 16 bytes 做 dev 金鑰
- 新產生器 `einvoice-proof-pdf.ts`：80mm 熱感紙寬度（227pt）layout，含期別／隨機碼／金額／兩組 QR／一維條碼
- 後台發票列表新增「PDF」按鈕：`GET /api/einvoices/:id/proof.pdf`
- 作廢發票 PDF 紅字「已作廢」；`printFlag=N`（載具／捐贈）顯示「本聯僅供存查」

**後台公司資料頁新增「電子發票設定」區塊**
- 啟用／賣方資料／稅籍編號／Turnkey 目錄／Turnkey 上線通行碼／QR AES 金鑰（空白保留原值）／預設稅別／載具開關／捐贈開關／預設列印註記
- 金鑰 GET 時不回傳明文，只回 `qrAesKeySet: boolean`

### Added — schema 欄位
- `Einvoice`: `randomCode` / `carrierType` / `carrierId` / `npoban` / `printFlag`（default `Y`）
- `Tenant.einvoices` 反向關聯現已加入 `allowances`

### Changed
- `Tenant.settings.einvoice` 擴充：`sellerAddress` / `taxRegistrationNo` / `turnkeyOnlineCode` / `qrAesKey` / `enableCarrier` / `enableDonation` / `defaultPrintFlag`
- `xml-builder.ts`：`buildC0401` 帶 `InvoiceType` / `DonateMark` / `PrintMark` / `RandomNumber` / `CarrierType` / `CarrierId1,2` / `NPOBAN`
- 新增 `buildD0401` / `buildD0501` / `buildC0701` 三種 XML 產生器
- 開立 service 注入 `randomCode` / `printFlag` 並持久化到 Einvoice

### Security
- AES 金鑰 DB 內儲存；GET `/tenant/me/einvoice-settings` 不回傳明文
- 證明聯 PDF 路由無 token（已在 authMiddleware 後），只回當前 tenant 的發票

### 重要注意事項（正式上線前必做）
- 向整合平台申請正式 AES 金鑰並從「公司資料 → 電子發票設定」填入；否則 QR 上傳平台驗證會失敗
- Turnkey 上線通行碼目前僅存設定，未做實際連線檢測（手動 Turnkey 桌面程式仍以 inbound 資料夾為介面）
- 數位簽章（`<Signature>`）未實作；若 Turnkey 不補簽，需加 XMLDSig

### Migration (SQL, 已透過 `prisma db push` 套用)
```sql
ALTER TABLE "Einvoice"
  ADD COLUMN "randomCode"  TEXT,
  ADD COLUMN "carrierType" TEXT,
  ADD COLUMN "carrierId"   TEXT,
  ADD COLUMN "npoban"      TEXT,
  ADD COLUMN "printFlag"   TEXT NOT NULL DEFAULT 'Y';

CREATE TABLE "EinvoiceAllowance" (...);
CREATE TABLE "EinvoiceAllowanceItem" (...);
-- 指標／FK 細節見 Prisma migration diff
```

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
