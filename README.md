# ERP LINE Bot

多租戶 LINE Bot 驅動的 ERP 系統（報價／銷貨／進貨／應收應付／庫存／月結對帳）。

- **介面**：LINE Messaging API + LIFF 表單
- **後端**：Express 5 + TypeScript (Node16 ESM)
- **資料庫**：PostgreSQL 14+ with `pg_trgm` extension
- **ORM**：Prisma 7
- **AI**：OpenAI Whisper（語音）、Google Vision（名片 OCR）、Claude Haiku（意圖解析）

---

## 快速啟動

### 1. 安裝相依套件

```bash
npm install
```

### 2. 設定環境變數

```bash
cp .env.example .env
# 編輯 .env，至少填入 DATABASE_URL
```

**必要變數**：
- `DATABASE_URL` — PostgreSQL 連線字串（須 pg_trgm extension）

**選用變數（功能解鎖）**：
- `LINE_CHANNEL_*` — 預設 LINE channel（各 tenant 也能自己帶）
- `OPENAI_API_KEY` — 啟用語音開單
- `GOOGLE_VISION_API_KEY` — 啟用名片 OCR
- `ANTHROPIC_API_KEY` — 啟用語音指令解析
- `SMTP_*` — 啟用月結對帳單 Email 發送

### 3. 初始化資料庫

```bash
# 建立 pg_trgm extension（一次性，需 superuser）
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 建立 migration 並套用
npx prisma migrate dev --name init

# 產生 Prisma client
npm run db:generate

# 塞入 demo 資料（潤樋實業、示範客戶/供應商/產品、管理員員工）
npm run db:seed
```

### 4. 啟動

```bash
npm run dev       # 開發模式（tsx watch）
# or
npm run build && npm start
```

伺服器會在 `PORT`（預設 3000）啟動，並自動：
- 每日 09:00 Asia/Taipei 跑逾期提醒
- 每月 1 號 09:30 Asia/Taipei 跑月結對帳單
- 註冊庫存事件監聽（銷貨 → 扣庫存、進貨 → 加庫存）

---

## LINE Webhook 設定

每個 tenant 有自己的 webhook 路徑：

```
https://<your-domain>/webhook/<tenantId>
```

將此 URL 設定到 LINE Developers → Messaging API → Webhook URL。

`Tenant.lineChannelSecret` 用於簽章驗證，`Tenant.lineAccessToken` 用於回覆訊息。

---

## LIFF 設定

1. LINE Developers → LIFF → Add
2. Endpoint URL：`https://<your-domain>/liff/quotation.html`
3. Scope：`profile openid`
4. 將 LIFF ID 填入 `public/liff/quotation.html` 的 `liff.init()`

---

## 員工綁定流程

1. 管理員呼叫 `POST /api/auth/bind/code`（header: `x-tenant-id`, `x-employee-id`；body: `{ employeeId: "001" }`）
2. 系統回傳 6 位綁定碼（10 分鐘有效）
3. 員工在 LINE 輸入「綁定 XXXXXX」
4. 綁定成功後即可使用所有指令

---

## LINE 指令速查

| 輸入 | 作用 |
|------|------|
| `報價` | 報價管理選單 |
| `銷貨` | 銷貨管理選單（新增／紀錄） |
| `進貨` | 進貨管理選單 |
| `帳務` | 應收／應付查詢選單 |
| `查詢 關鍵字` | 模糊搜尋客戶／產品／供應商 |
| 語音訊息 | Whisper + Haiku 語音開單／查詢 |
| 名片照片 | Vision OCR 自動建客戶 |

---

## 月結對帳單（ADMIN）

```bash
curl -X POST https://<your-domain>/api/statements/run \
  -H "x-tenant-id: <tenantId>" \
  -H "x-employee-id: <adminEmployeeId>" \
  -H "Content-Type: application/json" \
  -d '{"year": 2026, "month": 3}'
```

系統會對該月所有 AR/AP 產生 PDF 並 Email 給對應客戶／供應商。

---

## Excel 匯入

```bash
npm run import:excel <tenantId> <path-to-xlsx>
```

支援三張 sheet：`產品清單` / `客戶清單` / `供應商清單`。

---

## 部署建議

- **Render / Railway / Fly.io**：單機部署；PostgreSQL 用 Supabase（免費 500MB，附 pg_trgm）
- **注意**：LINE webhook 的 raw body 解析掛在 `/webhook`，JSON parser 之後才掛 API；勿改動 `src/index.ts` 的順序
- Session store 目前是 in-memory（30 分鐘 TTL），若跨實例部署需換 Redis

---

## 驗證

```bash
npx tsc --noEmit      # TypeScript 編譯檢查
npx prisma validate   # Schema 檢查
```
