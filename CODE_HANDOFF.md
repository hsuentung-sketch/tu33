# 🚀 ERP 系統 — CODE 交接檔案

**交接日期**: 2026-05-21  
**交接人**: Haiku (Claude Haiku 4.5)  
**目標受眾**: 核心開發團隊 (執行部署與上線)

---

## 📌 快速開始 (5 分鐘)

```bash
# 1. 複製環境配置
copy .env.demo .env

# 2. 編輯 .env — 設定你的 DATABASE_URL
# 例: DATABASE_URL="postgresql://user:password@localhost:5432/erp_dev"

# 3. 遷移資料庫
npm run migrate:deploy

# 4. 初始化 Demo 資料
npx ts-node --transpile-only src/scripts/demo-seed.ts

# 5. 啟動應用
npm run dev

# 6. 驗證
curl http://localhost:3000/api/demo/status
# 預期: {"status":"ok"}
```

---

## 📁 專案結構

```
ERP/
├── src/
│   ├── modules/                    # 功能模組
│   │   ├── core/                   # 核心功能
│   │   │   ├── billing/            # 計費管理 (訂閱、發票)
│   │   │   ├── version/            # 版本管理 (升級、Grace Period)
│   │   │   ├── demo/               # Demo 實例 (開發用)
│   │   │   └── analytics/          # 分析
│   │   ├── sales/                  # 銷售模組 (訂單、報價、客戶)
│   │   ├── purchase/               # 採購模組
│   │   ├── accounting/             # 會計模組 (發票、應付)
│   │   ├── inventory/              # 庫存模組
│   │   ├── documents/              # 文件管理
│   │   └── ...
│   ├── shared/                     # 共用層
│   │   ├── prisma.ts               # Prisma ORM 初始化
│   │   ├── errors.ts               # 自訂錯誤類別
│   │   ├── logger.ts               # 日誌系統
│   │   ├── tenant-isolation.ts     # 多租戶隔離驗證 (核心!)
│   │   ├── auth.ts                 # 認證中間件
│   │   └── middleware.ts           # 全局中間件
│   ├── line/                       # LINE Bot 集成
│   │   ├── client.ts               # LINE API 客戶端
│   │   └── handlers.ts             # LINE 訊息處理
│   ├── jobs/                       # 背景任務 (Cron jobs)
│   │   ├── invoice-boot-check.ts   # 啟動檢查
│   │   ├── version-check.ts        # 版本檢查
│   │   └── billing-cycle.ts        # 計費週期
│   ├── scripts/                    # 一次性腳本
│   │   └── demo-seed.ts            # Demo 資料初始化
│   ├── routes/                     # 路由聚合
│   │   └── index.ts                # 主路由文件 (⚠️ 注意順序!)
│   ├── app.ts                      # Express 應用初始化
│   └── index.ts                    # 入口點
├── prisma/
│   ├── schema.prisma               # 資料模型定義 (核心!)
│   └── migrations/                 # 資料庫遷移
├── docs/
│   ├── P2_DEMO_DEPLOYMENT.md       # Demo 部署指南
│   ├── P2_DEMO_QUICK_START.md      # 快速起步
│   ├── TENANT_ISOLATION.md         # 多租戶設計
│   ├── API_OVERVIEW.md             # API 文檔
│   └── ...
├── .env.demo                       # 環境變數範本
├── .env.production                 # 生產環境範本
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 環境配置

### 本機開發 (.env.demo)

```env
# 資料庫
DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_dev"

# 應用
NODE_ENV="development"
PORT=3000
PUBLIC_BASE_URL="http://localhost:3000"

# JWT
JWT_SECRET="dev-secret-change-in-production"
SESSION_SECRET="dev-secret-change-in-production"

# LINE Bot (Demo)
LINE_CHANNEL_ID="123456789"
LINE_CHANNEL_SECRET="dev-secret"
LINE_ACCESS_TOKEN="dev-token"

# 日誌
LOG_LEVEL="debug"

# 計費 (Demo)
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# 郵件 (Demo - 可選)
SMTP_HOST="smtp.gmail.com"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="app-password"

# AI 服務 (Demo)
OPENAI_API_KEY="sk-..."
GOOGLE_OCR_API_KEY="..."
```

### 生產環境 (.env.production)

```env
# 資料庫 — 必須設定，不允許預設值
DATABASE_URL="postgresql://prod-user:$(openssl rand -hex 16)@db.fly.io:5432/erp_prod"

# 應用
NODE_ENV="production"
PORT=8080
PUBLIC_BASE_URL="https://yourdomain.com"

# JWT — 必須設定，不允許預設值
JWT_SECRET="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"

# LINE Bot
LINE_CHANNEL_ID="your-real-channel-id"
LINE_CHANNEL_SECRET="your-real-secret"
LINE_ACCESS_TOKEN="your-real-token"

# 日誌
LOG_LEVEL="info"

# 計費
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_live_..."

# 郵件
SMTP_HOST="smtp.sendgrid.net"
SMTP_USER="apikey"
SMTP_PASS="SG...."

# AI 服務
OPENAI_API_KEY="sk-..."
GOOGLE_OCR_API_KEY="..."
```

**⚠️ 生產環境規則** (在 `src/index.ts` 強制):
- `NODE_ENV=production` 時，`JWT_SECRET` / `SESSION_SECRET` 若未設定必須 **throw 錯誤**，不可使用預設值
- `DATABASE_URL` 必須有效，否則 boot 時失敗
- 所有 webhook signing key 必須配置

---

## 🗄️ 資料庫

### 快速遷移

```bash
# 執行所有待處理遷移
npm run migrate:deploy

# 查看遷移狀態
npx prisma migrate status

# 查看資料庫架構
npx prisma db push  # (開發用，非生產)

# 重置資料庫 (開發用 — 會刪除所有資料!)
npx prisma migrate reset
```

### Schema 概覽 (核心模型)

```prisma
// 多租戶基礎
model Tenant {
  id String @id
  companyName String
  isActive Boolean
  createdAt DateTime
  
  // 計費
  billingPlanId String?
  billingPlan BillingPlan?
  subscriptions TenantVersionSubscription[]
  
  // 版本管理
  currentVersion String?
}

// 租戶員工 (隔離於 tenantId)
model Employee {
  id String @id
  tenantId String        // ⚠️ 必須驗證隔離
  tenant Tenant @relation(fields: [tenantId], references: [id])
  
  name String
  email String
  lineUserId String?     // ⚠️ 隔離驗證
  isActive Boolean
  
  @@unique([tenantId, email])
  @@index([tenantId])
}

// 銷售訂單 (隔離於 tenantId)
model SalesOrder {
  id String @id
  tenantId String        // ⚠️ 必須驗證隔離
  tenant Tenant @relation(fields: [tenantId], references: [id])
  
  orderNo String
  createdBy String       // Employee.id
  subtotal Decimal
  taxAmount Decimal
  total Decimal
  
  @@unique([tenantId, orderNo])
  @@index([tenantId])
}

// 版本管理
model VersionHistory {
  version String @id
  releaseDate DateTime
  supportedUntil DateTime  // Grace period: 30 days
  features String[]
  notes String?
  isActive Boolean
}

model TenantVersionSubscription {
  tenantId String @id
  tenant Tenant @relation(fields: [tenantId], references: [id])
  
  currentVersion String
  latestVersion String
  upgradeDeadline DateTime?
  lastUpgradedAt DateTime?
}

// 計費
model BillingPlan {
  id String @id
  name String         // "Starter", "Professional", "Enterprise"
  monthlyPrice Decimal
  features String[]
}

model Invoice {
  id String @id
  tenantId String
  tenant Tenant @relation(fields: [tenantId], references: [id])
  
  invoiceNo String
  issuedAt DateTime
  dueAt DateTime
  amount Decimal
  status String       // "draft", "issued", "paid"
  
  @@unique([tenantId, invoiceNo])
}
```

### 多租戶隔離驗證 (核心!)

所有租戶資料存取都必須通過驗證層:

```typescript
// 檔案: src/shared/tenant-isolation.ts

// ✅ 驗證員工隸屬於租戶
export async function verifyEmployeeInTenant(
  employeeId: string,
  tenantId: string
): Promise<boolean>

// ✅ 驗證訂單隸屬於租戶
export async function verifyOrderInTenant(
  orderId: string,
  tenantId: string
): Promise<boolean>

// ✅ 驗證 lineUserId 隸屬於租戶
export async function verifyLineUserInTenant(
  lineUserId: string,
  tenantId: string
): Promise<boolean>

// ✅ 驗證發票隸屬於租戶
export async function verifyInvoiceInTenant(
  invoiceId: string,
  tenantId: string
): Promise<boolean>

// 使用方式
const authMiddleware = async (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'];
  const userId = req.user.id;
  
  // 驗證用戶確實屬於此租戶
  if (!await verifyEmployeeInTenant(userId, tenantId)) {
    throw new UnauthorizedError('User does not belong to this tenant');
  }
  
  next();
};
```

**⚠️ 關鍵規則**:
1. 每個資料查詢都必須加上 `tenantId` 過濾
2. 資料修改前必須驗證 `tenantId` 所有權
3. 不允許跨租戶查詢 (即使是 admin 也要明確指定租戶)

---

## 🚀 API 概覽

### 公開端點 (無需認證)

```
POST /api/auth/login              # 登入
POST /api/auth/register           # 註冊
POST /api/auth/logout             # 登出

POST /webhook/line                # LINE Bot webhook
POST /webhook/stripe              # Stripe webhook
```

### Demo 端點 (開發用)

```
GET  /api/demo/status             # 檢查 demo 狀態
POST /api/demo/reset              # 重置 demo 資料
GET  /api/demo/export             # 匯出 demo 資料 (JSON)
GET  /api/demo/metrics            # Demo 統計 (租戶數、員工數等)
POST /api/demo/seed-config        # 自訂 seed 參數
```

### 認證後端點 (需要 JWT Token)

```
# 銷售
GET  /api/sales/orders            # 列出訂單
POST /api/sales/orders            # 建立訂單
GET  /api/sales/orders/:id        # 取得訂單詳情
PATCH /api/sales/orders/:id       # 修改訂單

# 客戶
GET  /api/sales/customers         # 列出客戶
POST /api/sales/customers         # 建立客戶

# 版本
GET  /api/core/version/status     # 獲取版本狀態
POST /api/core/version/upgrade    # 升級版本

# 計費
GET  /api/billing/plans           # 列出計畫
GET  /api/billing/subscription    # 獲取訂閱狀態
POST /api/billing/upgrade-plan    # 升級計畫

# 員工
GET  /api/employees               # 列出員工
POST /api/employees               # 新增員工
PATCH /api/employees/:id          # 修改員工

# 發票
GET  /api/accounting/invoices     # 列出發票
POST /api/accounting/invoices     # 建立發票
```

### 請求格式

```bash
# 認證 Header
curl -H "Authorization: Bearer {JWT_TOKEN}" \
     -H "X-Tenant-ID: {TENANT_ID}" \
     http://localhost:3000/api/sales/orders

# 請求 Body (JSON)
{
  "orderNo": "SO-2026-001",
  "customerId": "cust_123",
  "items": [
    {
      "productId": "prod_456",
      "quantity": 10,
      "unitPrice": 100.00
    }
  ]
}
```

---

## 🐛 已知問題 & 修復

### 問題 1: TypeScript 編譯錯誤

**症狀**: `npm run build` 失敗

**修復** ✅ (已完成):
- ✅ Prisma 導入: 改用 `import { Prisma } from '@prisma/client'` (值導入)
- ✅ Decimal 算術: 加 `Number()` 轉換
- ✅ Express req.params: 加 `as { planId: string }` 型別斷言
- ✅ LINE API: 改為 `{ to: emp.lineUserId, messages: [message] }`
- ✅ version.service.ts: 完全重寫

**驗證**: `npm run build` → 成功 (只有 3 個 @jest/globals 警告，非關鍵)

---

### 問題 2: 應用啟動失敗

**症狀**:
```
Error: Authentication failed against the database server
Location: src/jobs/invoice-boot-check.ts:30
```

**根本原因**: `.env` 中 `DATABASE_URL` 未配置或無效

**修復**:
1. 確認 PostgreSQL 在本機執行: `pg_isready -h localhost`
2. 建立開發資料庫: `createdb erp_dev`
3. 編輯 `.env`:
   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_dev"
   ```
4. 執行遷移: `npm run migrate:deploy`
5. 初始化資料: `npx ts-node --transpile-only src/scripts/demo-seed.ts`
6. 啟動: `npm run dev`

**驗證**: 
```bash
curl http://localhost:3000/api/demo/status
# 預期: {"status":"ok"}
```

---

### 問題 3: LINE 推播失敗

**症狀**:
```
Failed to push message: Invalid channel access token
```

**修復**:
- 確認 `.env` 中 `LINE_ACCESS_TOKEN` 正確
- 驗證 `LINE_CHANNEL_ID` 與 `LINE_CHANNEL_SECRET` 相符
- 檢查員工的 `lineUserId` 是否正確設置

**測試**:
```bash
# 在 demo seed 後檢查
npx ts-node -e "
const { prisma } = require('./src/shared/prisma.js');
prisma.employee.findFirst({
  where: { lineUserId: { not: null } }
}).then(e => console.log('Employee with LINE:', e));
"
```

---

## 🔄 部署流程

### 本機部署 (開發)

```bash
# 1. 環境配置
copy .env.demo .env
# 編輯 .env 設定 DATABASE_URL

# 2. 裝依賴
npm install

# 3. 編譯
npm run build

# 4. 遷移
npm run migrate:deploy

# 5. 初始化資料
npx ts-node --transpile-only src/scripts/demo-seed.ts

# 6. 啟動
npm run dev

# 7. 驗證
curl http://localhost:3000/api/demo/status
```

### Fly.io 部署 (生產)

```bash
# 1. 登入 Fly.io
fly auth login

# 2. 建立應用
fly apps create erp-prod

# 3. 配置環境變數
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set JWT_SECRET="$(openssl rand -hex 32)"
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
# ... 其他變數

# 4. 建立 PostgreSQL
fly postgres create --name erp-db
fly postgres attach erp-db -a erp-prod

# 5. 部署
fly deploy

# 6. 執行遷移
fly ssh console
npm run migrate:deploy
npx ts-node --transpile-only src/scripts/demo-seed.ts
exit

# 7. 查看日誌
fly logs
```

詳見: `docs/FLY_DEPLOYMENT_CHECKLIST.md`

---

## 📊 版本管理

### 版本生命週期

```
發布新版本 (v1.0.0)
    ↓
寬限期: 30 天 (Grace Period)
    ↓
租戶必須升級或自動升級 (auto-upgrade cron)
    ↓
舊版本停用
```

### 手動升級

```bash
# 檢查版本狀態
curl -H "Authorization: Bearer {TOKEN}" \
     http://localhost:3000/api/core/version/status

# 手動升級
curl -X POST \
     -H "Authorization: Bearer {TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"targetVersion": "1.1.0"}' \
     http://localhost:3000/api/core/version/upgrade
```

### 自動升級 (Cron Job)

在 `src/jobs/version-check.ts` 中：
- 每天檢查過期的租戶
- 自動升級到最新版本
- 發送 LINE 通知

---

## 💰 計費系統

### 訂閱流程

```
租戶註冊
    ↓
選擇計畫 (Starter / Professional / Enterprise)
    ↓
建立 Stripe subscription
    ↓
TenantVersionSubscription 記錄
    ↓
計費週期內自動續訂
    ↓
過期前 7 天警告 (LINE)
```

### 計費模型

```
Starter     | $99/月  | 基礎功能
Professional | $299/月 | 銷售 + 採購
Enterprise  | $599/月 | 全功能 + 優先支持
```

詳見: `prisma/schema.prisma` 中 `BillingPlan` 和 `TenantBillingInfo` 模型

---

## 🧪 測試

### 執行測試

```bash
# 單元測試
npm run test

# 集成測試
npm run test:integration

# 所有測試
npm run test:all

# 監視模式
npm run test:watch
```

### Demo 測試

```bash
# 重置並驗證 demo
curl -X POST http://localhost:3000/api/demo/reset
curl http://localhost:3000/api/demo/status
curl http://localhost:3000/api/demo/metrics
```

---

## 📝 日誌 & 監控

### 日誌位置

- **應用日誌**: `src/shared/logger.ts` (Winston)
- **日誌級別**: `DEBUG` (開發) / `INFO` (生產)
- **輸出**: Console (開發) / 檔案 + Datadog (生產)

### 監控

```bash
# 查看實時日誌
npm run dev  # 帶時戳與顏色的日誌

# 生產日誌
fly logs -a erp-prod

# Datadog 監控
# 連接至 Datadog dashboard (待設置)
```

---

## 🚨 故障排查

### 應用無法啟動

```bash
# 1. 檢查環境變數
cat .env | grep DATABASE_URL

# 2. 檢查 PostgreSQL 連接
psql -U postgres -d erp_dev -h localhost -c "SELECT 1;"

# 3. 檢查日誌
npm run dev 2>&1 | head -50

# 4. 檢查遷移狀態
npx prisma migrate status
```

### 數據庫連接失敗

```bash
# 驗證 PostgreSQL 服務
pg_isready -h localhost -U postgres

# 檢查資料庫是否存在
psql -U postgres -l | grep erp_dev

# 重新建立資料庫
dropdb erp_dev
createdb erp_dev
npm run migrate:deploy
```

### 認證失敗

```bash
# 檢查 JWT_SECRET 是否設置
grep JWT_SECRET .env

# 測試認證端點
curl -X POST http://localhost:3000/api/auth/login \
     -d '{"email":"admin@example.com","password":"password"}' \
     -H "Content-Type: application/json"
```

### LINE 訊息未送達

```bash
# 1. 檢查 LINE 設置
grep LINE_ .env

# 2. 驗證員工 lineUserId
npx ts-node -e "
const { prisma } = require('./src/shared/prisma.js');
prisma.employee.findMany({
  where: { lineUserId: { not: null } }
}).then(e => console.log('Employees:', e.length));
"

# 3. 查看版本通知日誌
npm run dev | grep "version.*notification"
```

---

## 🔐 安全性檢查清單

### 部署前檢查

- [ ] `JWT_SECRET` 已設置 (生產環境強制)
- [ ] `SESSION_SECRET` 已設置 (生產環境強制)
- [ ] `DATABASE_URL` 使用強密碼
- [ ] `LINE_CHANNEL_SECRET` 已驗證
- [ ] `STRIPE_SECRET_KEY` 為 live key (生產)
- [ ] HTTPS 已啟用 (生產)
- [ ] CORS 已配置 (僅允許必要域名)
- [ ] 速率限制已啟用 (防止濫用)

### 多租戶隔離驗證

- [ ] 所有查詢都有 `tenantId` 過濾
- [ ] 修改前驗證租戶所有權
- [ ] webhook 驗證簽名 (LINE / Stripe)
- [ ] 員工無法存取其他租戶資料

---

## 📚 相關文檔

- `docs/P2_DEMO_DEPLOYMENT.md` — Demo 部署詳細步驟
- `docs/P2_DEMO_QUICK_START.md` — 5 分鐘快速起步
- `docs/TENANT_ISOLATION.md` — 多租戶架構設計
- `docs/API_OVERVIEW.md` — 完整 API 文檔
- `HANDOFF_TO_OPUS46.md` — 高層部署規劃

---

## 🎯 核心命令

```bash
# 開發
npm run dev                        # 啟動開發伺服器 (hot reload)
npm run build                      # 編譯 TypeScript
npm run start                      # 執行已編譯的代碼

# 數據庫
npm run migrate:deploy             # 執行遷移
npm run migrate:create             # 建立新遷移
npx prisma studio                  # GUI 資料庫瀏覽器

# 測試
npm run test                       # 執行測試
npm run test:watch                 # 監視模式

# Demo
npm run dev:seed                   # 啟動 + 初始化資料
npm run db:reset                   # 清除所有資料並重新遷移

# 代碼品質
npm run lint                       # ESLint 檢查
npm run format                     # Prettier 格式化
npm run type-check                 # TypeScript 型別檢查
```

---

## ⚠️ 即將推出的功能

### P2-2: Feature Catalog
- 功能啟用/禁用管理
- 計畫與功能對應
- Admin 功能管理介面

### P2-3: Line Bot 完整整合
- 訊息快速回覆 (safeSend fallback)
- Rich Menu 互動
- 推播通知優化

### P3-1: Performance Dashboard
- 租戶使用量追蹤
- 功能採用率分析
- 計費影響分析

---

## 📞 技術支持

遇到問題？
1. 檢查故障排查部分 (本文件)
2. 查看日誌: `npm run dev`
3. 檢查已知問題
4. 聯絡開發團隊

---

**CODE 交接完成**  
**版本**: 1.0.0 (開發版)  
**最後更新**: 2026-05-21  
**交接狀態**: ✅ 準備好執行
