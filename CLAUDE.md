# ERP 專案工作紀錄（LINE Bot 版）

潤樋實業股份有限公司 — 從 Excel/Google Sheets 遷移至 LINE Bot 驅動的多租戶 ERP。

---

## 技術棧

- **後端**：Express 5 + TypeScript (ESM)
- **DB**：PostgreSQL + Prisma 7（driver adapter）
- **部署**：Render（自動從 GitHub main 分支部署）
- **LINE**：Messaging API + LIFF（複雜表單）
- **文件**：PDFKit（PDF）、ExcelJS（匯入）
- **AI**：OpenAI Whisper（語音）、Google Vision（名片 OCR）、Claude Haiku（語音指令解析）

## 關鍵環境 & URL

- GitHub: https://github.com/hsuentung-sketch/tu33
- Render: https://erp-line-bot.onrender.com
- LIFF ID (報價單): `2009797959-uDVN0eGQ`（LINE Login channel 2009797959）
- Messaging API Channel ID: 2009636862
- Tenant 設定中存 `settings.lineLoginChannelId = '2009797959'` 用來把 LIFF id-token → tenant

---

## 專案結構重點

```
src/
├── index.ts                 # Express 入口，/pdf 掛在 authMiddleware 之前
├── config/index.ts          # 讀 env，publicBaseUrl 預設 onrender.com
├── routes/
│   ├── index.ts             # apiRouter 掛 authMiddleware，含 /api/me
│   └── pdf.router.ts        # 公開 PDF 下載（JWT-token 驗證）
├── documents/
│   ├── pdf-generator.ts     # 報價/銷貨/進貨 PDF（title band + grid + totals）
│   └── pdf-link.ts          # signPdfToken / verifyPdfToken / buildPdfUrl
├── line/
│   ├── session.ts           # 記憶體 session（含 pendingProduct）
│   ├── handlers/
│   │   ├── index.ts         # 訊息/postback 分派
│   │   ├── sales.handler.ts # 銷貨流程（含產品 flex 搜尋）
│   │   ├── purchase.handler.ts # 進貨流程（含產品 flex 搜尋）
│   │   └── quotation.handler.ts # 報價流程（走 LIFF）
│   └── templates/…
├── modules/
│   ├── core/auth/…          # LIFF 驗證 + 一般 authMiddleware
│   ├── master/
│   │   ├── product/         # findByNameOrCode 模糊搜尋
│   │   ├── customer/
│   │   ├── supplier/
│   │   └── employee/
│   ├── sales/
│   │   ├── quotation/
│   │   └── sales-order/
│   ├── purchase/purchase-order/
│   └── accounting/…         # receivable / payable
├── shared/                  # prisma / logger / errors / search / audit
├── tools/                   # 匯入 Excel / rename-employee / 設定 loginChannel
└── assets/fonts/            # NotoSansTC-Regular.ttf（build 時下載，.gitignore）

public/liff/
└── quotation.html           # 報價單 LIFF 表單（客戶+產品 autocomplete）

scripts/
└── download-fonts.mjs       # 從 google/fonts 抓 CJK TTF（含 size check）
```

---

## 核心業務流程

1. **報價**（LIFF）→ 可轉銷貨單
2. **銷貨**（LINE chat）→ 自動產生 PDF + 應收帳款
3. **進貨**（LINE chat）→ 自動產生 PDF + 應付帳款
4. **帳務**：月結 N 天自動計算到期日；到期前 15 天提醒
5. **主檔**：產品/客戶/供應商/員工

付款日公式（Excel EOMONTH 還原）：
```
dueDate = endOfMonth(addMonths(firstOfMonth(billingYear, billingMonth), paymentDays / 30))
```

---

## 近期完成的重要工作

### 1. 部署基礎設施
- 多租戶 LIFF 驗證：`lineChannelId` OR `settings.lineLoginChannelId` 雙路查找（`liff-auth.middleware.ts`）
- `/api/me` 端點回員工資訊（給 LIFF 表單帶入業務姓名）
- Render build command: `npm ci --include=dev && npx prisma generate && npm run fonts:download && npm run build`

### 2. Rich Menu
- `src/tools/generate-rich-menu-image.ts`：SVG + sharp 產生 2500×1686 PNG
- 6 格：報價 / 銷貨 / 進貨（上）/ 帳務 / 查詢 / 報價追蹤（下）
- 「報價追蹤」字體縮小（170）避免換行

### 3. Excel 匯入
- `src/tools/import-excel.ts`（`import 'dotenv/config'`）
- 供應商欄位名 fallback：`類型 ?? 供應商類型 ?? type`、`付款天數 ?? 付款日 ?? paymentDays`
- 已匯入：30 產品 / 4 客戶 / 2 供應商

### 4. PDF 下載（公開連結）
- 每筆銷貨/進貨/報價建立後產生 JWT 簽名的短連結（預設 7 天）
- `/pdf/:kind/:id?token=...` **掛在 authMiddleware 之前**，讓 LINE 用戶點連結能直接下載
- 訊息格式：`📄 下載 PDF：https://erp-line-bot.onrender.com/pdf/sales-order/xxx?token=…`

### 5. CJK 字型處理（踩過兩個坑）
- ❌ `notofonts/noto-cjk` raw URL 回的是 Git LFS 指針（~130B），字型載入失敗 fallback Helvetica → PDF 中文亂碼
- ✅ 改用 `raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC[wght].ttf`（~12MB，非 LFS）
- 加檔案大小檢查（<1MB 視為失敗），build 時若失敗直接 exit 1，不讓服務帶著壞字型上線

### 6. PDF 防禦式 error handling
- PDFKit 非同步發 `error` 事件，若沒 listener 會 crash 整個 Node process（使用者點連結 → 服務掛掉 status 1）
- 新增 `streamPdf()` helper：try/catch + `doc.on('error')` + 已送出 header 時只 end，不重送

### 7. PDF 配版重寫
- 標題色帶（藍底）：標題左 + 公司名右
- 雙欄資訊格（有框線）：公司/聯絡人/統編/電話/地址/送貨備註 vs 業務/電話/地址/單號/日期
- 有框線的品項表 + 右下角總計區塊（小計 / 營業稅 / 總計）
- 三種單據（報價/銷貨/進貨）共用 `drawTitleBand` / `drawInfoGrid` / `drawItemTable` / `drawTotals` helpers

### 8. LIFF 報價單表單（public/liff/quotation.html）
- LIFF ID 寫死，query string 可覆蓋
- `/api/me` 自動帶入業務姓名
- 客戶搜尋用 `?q=`（不是 `?search=`），單一結果自動選
- 產品 `<datalist>` autocomplete，快取 salePrice 自動帶入
- 送出後 `liff.sendMessages`（only if `liff.isInClient()`）+ alert 顯示 PDF URL

### 9. LINE chat 產品搜尋（Flex Carousel）
在銷貨/進貨的「輸入品項」步驟：
- 使用者輸入完整 `<品名> <數量> <單價>` → 直接加入
- 使用者輸入關鍵字（如「6336」）→ 模糊搜尋產品，回覆 **Flex Message 輪播卡片**（最多 10 張）
- 每張卡片顯示：
  - 產品全名（wrap，不截斷）
  - 建議售價 / 參考進價（產品主檔）
  - 上次成交 / 上次進價（**該客戶/供應商**歷史，無 → `null`）
  - 交易日 / 進貨日
  - 綠色「選擇」按鈕（postback）
- 按選擇後，session.data.pendingProduct 存 `{name, salePrice, costPrice}`
- 下一則訊息：「數量」（用建議價）或「數量 單價」→ 加入品項

為什麼用 Flex 不用 buttons template：後者 label 上限 20 字元，會把價格切掉（`EK-SS-6336 1/200 $21` ← 被截）。

---

## 未完成 / 待驗證

### 🔄 目前進度暫停點（2026-04-14）
**最新 commit：`533c7ac` LINE product search: flex carousel with price history**

已推送到 Render，使用者暫停測試。重啟時請驗證：
1. 銷貨 → 選客戶（毅金）→ 輸入「6336」
2. 應跳出 2 張可滑動卡片，資訊完整不截斷
3. 按「選擇」→ 進入 pendingProduct 流程
4. 輸入「2」或「2 21000」→ 加入品項

### 待做
- 銷貨單「送貨備註」在 LINE chat 流程沒有收集（PDF 會留空）
- 報價追蹤流程（從 LINE Rich Menu 進入）尚未實作
- 逾期帳款 LINE 推播（cron job）
- 語音開單（Whisper）整合測試
- 名片 OCR（Google Vision）整合測試
- 多公司複製流程的管理介面

### 可能的使用者未來需求（記下備參）
- LIFF 銷貨/進貨表單（像 LIFF 報價單那樣的 autocomplete 體驗）
- 月結對帳單 PDF
- 庫存追蹤
- 銷售報表（毛利分析）

---

## 開發常用指令

```bash
# 本機編譯檢查
npx tsc --noEmit

# 本機跑
npx tsx src/index.ts

# Prisma
npx prisma migrate dev
npx prisma studio

# 匯入 Excel（注意：import-excel.ts 需要 .env 裡的 DATABASE_URL）
npx tsx src/tools/import-excel.ts

# 產生 Rich Menu 圖
npx tsx src/tools/generate-rich-menu-image.ts

# 重新命名員工
npx tsx src/tools/rename-employee.ts <employeeId> <newEmployeeCode> <newName>
```

## Git 身份
- Author: `ERP Dev <erp@local>`（用 `git -c user.name=... -c user.email=...` commit，專案沒設 global）

## 踩過的坑備忘
- Express 5：mount 順序重要，`/pdf` **必須在 authMiddleware 之前**
- Prisma 7：用共享的 `prisma` client（`src/shared/prisma.ts`），不要 `new PrismaClient()`
- LINE button template label 上限 20 字元，超過會被 API 拒絕或截斷 → 改用 Flex
- PDFKit 不支援 WOFF2；只支援 TTF/OTF/TTC
- `raw.githubusercontent.com` 對 LFS 檔回指針不回檔案 → 改用非 LFS 路徑
- PDFKit 的 `doc.on('error')` **必須在 `doc.pipe()` 前註冊**，否則 async error 炸 Node
- `jsonwebtoken` 的 `expiresIn` 要傳 number（秒）或字串（如 `'7d'`）
