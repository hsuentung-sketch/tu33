# P2-1 Demo Instance 部署指南

**完成日期：** 2026-05-21  
**狀態：** ✅ 就緒部署

---

## 概覽

Demo Instance 是一個完整的、獨立的 ERP SaaS 實例，用於：
- 展示系統功能給潛在客戶
- 內部產品演示和測試
- 進行自動化 E2E 測試

### 核心特性

| 特性 | 說明 |
|------|------|
| **租戶** | 某環保公司（demo_eco_company_001） |
| **員工** | 20 人（ADMIN, SALES, PURCHASING, ACCOUNTING） |
| **客戶** | 50 家（製造、批發、零售、服務等） |
| **計畫** | 3 套（Starter, Professional, Enterprise） |
| **預設訂閱** | Professional 月繳方案 |
| **重置功能** | POST /api/demo/reset 自動重新初始化 |

---

## 快速開始

### 1. 前置需求

```bash
# 工具版本
- Node.js v20+
- Docker & Docker Compose（容器化部署）
- Fly.io CLI（Fly 部署）
- PostgreSQL 14+（本地開發）
```

### 2. 本地測試

```bash
# 1. 複製 .env.demo
cp .env.demo .env

# 2. 編輯 .env 設定開發用 PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/erp_demo"

# 3. 執行遷移
npm run migrate:deploy

# 4. 執行 seed 腳本
npm run seed:demo

# 5. 啟動應用
npm run dev

# 6. 驗證
curl http://localhost:3000/api/demo/status
curl -X POST http://localhost:3000/api/demo/reset
```

### 3. 部署到 Fly.io

#### 3.1 初始化 Fly 應用

```bash
# 列出現有的 Fly 應用
fly list

# 如果需要新建應用用於 demo：
fly apps create erp-demo

# 設定 region（推薦 nrt 東京，距台灣近）
# 編輯 fly.toml
# app = 'erp-demo'
# primary_region = 'nrt'
```

#### 3.2 設定 PostgreSQL（Fly Postgres）

```bash
# 創建 Postgres 副本應用
fly postgres create --name erp-demo-db --region nrt

# 驗證連線
fly postgres connect -a erp-demo-db

# 記下 Database URL（格式如下）
# postgres://postgres:PASSWORD@erp-demo-db.internal:5432/postgres
```

#### 3.3 設定環境變數

```bash
# 設定 NODE_ENV=demo（啟用 demo API）
fly secrets set NODE_ENV=demo -a erp-demo

# 設定 DATABASE_URL
fly secrets set DATABASE_URL="postgres://..." -a erp-demo

# 設定 JWT_SECRET（生成安全隨機值）
openssl rand -hex 32  # 複製輸出
fly secrets set JWT_SECRET="..." -a erp-demo

# 設定 LINE Bot（可留空，演示用）
fly secrets set LINE_CHANNEL_ID="" -a erp-demo
fly secrets set LINE_CHANNEL_SECRET="" -a erp-demo
fly secrets set LINE_CHANNEL_ACCESS_TOKEN="" -a erp-demo

# 其他可選 API keys（演示時可留空）
fly secrets set OPENAI_API_KEY="" -a erp-demo
fly secrets set ANTHROPIC_API_KEY="" -a erp-demo
fly secrets set GOOGLE_VISION_API_KEY="" -a erp-demo
```

#### 3.4 執行部署

```bash
# 使用 GIT_COMMIT 標籤（便於追蹤版本）
fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD) -a erp-demo

# 監控日誌
fly logs -a erp-demo

# 驗證部署成功
curl https://erp-demo.fly.dev/api/demo/status
```

#### 3.5 初始化 Demo 資料

```bash
# 等待部署完成後，觸發 seed 腳本
curl -X POST https://erp-demo.fly.dev/api/demo/reset

# 預期響應
# {
#   "status": "success",
#   "message": "Demo 資料已重置",
#   "timestamp": "2026-05-21T10:30:00.000Z"
# }
```

---

## 環境設定清單

### .env.demo 模板

```env
# ===== 演示環境設定 =====
NODE_ENV=demo
PORT=3000

# Database — Fly Postgres 或本地 PostgreSQL
DATABASE_URL="postgresql://user:password@host:5432/erp_demo"

# JWT — 必須在生產環境設定
JWT_SECRET=your-secure-random-secret-here
JWT_EXPIRES_IN=7d

# LINE Bot — 演示時可留空
LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=

# Email — 演示時可留空
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# AI/Vision APIs — 演示時可留空
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_VISION_API_KEY=
```

### 部署前檢查表

- [ ] `npm run build` 執行成功，無編譯錯誤
- [ ] `npm test` 通過（或 `npm run test:unit`）
- [ ] `git commit` 和 `git push` 已完成
- [ ] `fly.toml` 中 `app` 和 `primary_region` 已設定
- [ ] PostgreSQL 資料庫已創建
- [ ] 所有 secrets 已使用 `fly secrets set` 設定
- [ ] `Dockerfile` 包含正確的 build 和 runtime 指令

---

## Demo API 端點

### 重置演示資料

```http
POST /api/demo/reset

# 響應
{
  "status": "success",
  "message": "Demo 資料已重置",
  "timestamp": "2026-05-21T10:30:00.000Z",
  "output": "✅ Demo seed completed successfully!..."
}
```

**注意：** 此端點僅在 `NODE_ENV=demo` 或 `NODE_ENV=development` 時可用。

### 查詢演示實例狀態

```http
GET /api/demo/status

# 響應
{
  "environment": "demo",
  "isDemoAvailable": true,
  "resetApiAvailable": true,
  "demoTenantId": "demo_eco_company_001",
  "timestamp": "2026-05-21T10:30:00.000Z"
}
```

---

## 預設演示資料

### 租戶

| 欄位 | 值 |
|------|-----|
| **名稱** | 某環保公司 |
| **ID** | demo_eco_company_001 |
| **稅號** | 11223344 |
| **電話** | 02-2345-6789 |
| **郵箱** | demo@ecoco.com.tw |

### 計畫方案

| 計畫 | 月費 | 年費 | 設計費 | 試用期 | 功能 |
|------|------|------|--------|--------|------|
| **Starter** | $99 | $999 | $50 | 14 天 | 銷售、客戶管理 |
| **Professional** | $299 | $2,999 | $100 | 30 天 | 銷售、採購、庫存、會計 |
| **Enterprise** | $599 | $5,999 | $200 | 60 天 | 全功能（含佣金） |

### 員工分佈（20 人）

```
- ADMIN：5 人（管理員）
- SALES：5 人（銷售）
- PURCHASING：5 人（採購）
- ACCOUNTING：5 人（會計）
```

### 客戶分佈（50 家）

```
- 製造業：10 家
- 批發業：10 家
- 零售業：10 家
- 服務業：10 家
- 其他：10 家
```

### 銷售訂單（10 筆）

每筆訂單包含 2 行項目（PROD001, PROD002），狀態涵蓋 DRAFT / CONFIRMED / SHIPPED / CLOSED。

### 發票（3 筆）

- 當月：ISSUED 狀態
- 上月：PAID 狀態
- 上上月：PAID 狀態

---

## 故障排除

### 問題：Deploy 後訪問 500 錯誤

**排查步驟：**

```bash
# 1. 檢查日誌
fly logs -a erp-demo | tail -50

# 常見原因：
# - DATABASE_URL 未設定或格式錯誤
# - Prisma migration 未執行
# - JWT_SECRET 為空

# 2. 驗證 Database 連線
fly ssh console -a erp-demo
psql $DATABASE_URL -c "SELECT 1"

# 3. 重新執行遷移
fly exec -a erp-demo "npm run migrate:deploy"
```

### 問題：Demo reset 端點返回 403

```bash
# 原因：NODE_ENV 未設定為 demo 或 development
# 解決方案：
fly secrets set NODE_ENV=demo -a erp-demo
fly deploy -a erp-demo  # 重新部署
```

### 問題：Postgres 磁盤空間不足

```bash
# 檢查 Postgres 狀態
fly status -a erp-demo-db

# 擴展儲存
fly scale volume <volume_id> --size <new_size_gb>

# 或清理舊資料
fly exec -a erp-demo-db "psql ... VACUUM FULL"
```

---

## 監控與維護

### 日誌監控

```bash
# 實時日誌
fly logs -a erp-demo

# 特定時間範圍
fly logs -a erp-demo --since 1h

# 過濾特定內容
fly logs -a erp-demo | grep ERROR
```

### 健康檢查

```bash
# Fly 內建健康檢查（30 秒間隔）
fly status -a erp-demo

# 手動檢查
curl https://erp-demo.fly.dev/health
```

### 定期任務

```bash
# Cron jobs 運行狀態：
# - 每日 10:00 AM：版本自動升級
# - 每日 03:00 AM：計費自動續訂
# - 每日 04:00 AM：逾期發票檢查

# 查看 Cron 日誌
fly logs -a erp-demo | grep cron
```

---

## 回滾與恢復

### 恢復到上一版本

```bash
# 查看歷史部署
fly releases -a erp-demo

# 恢復到特定版本
fly releases rollback -a erp-demo

# 或手動重新部署特定 commit
git checkout <commit-hash>
fly deploy -a erp-demo --build-arg GIT_COMMIT=<commit-hash>
```

### 資料庫備份

```bash
# 備份 Postgres
fly exec -a erp-demo-db "pg_dump $DATABASE_URL > /tmp/backup.sql"

# 或使用 Fly backup
fly postgres backup create -a erp-demo-db

# 列出備份
fly postgres backups list -a erp-demo-db
```

---

## 進階配置

### 自動擴展

```toml
# 編輯 fly.toml，新增自動擴展配置
[[vm]]
size = 'shared-cpu-1x'
memory = '512mb'

[metrics]
  cpu_percent = 80
  memory_percent = 80

# 最多 3 個實例
[autoscale]
  min_machines = 1
  max_machines = 3
```

### 自訂域名

```bash
# 綁定域名
fly certs add demo.yourcompany.com -a erp-demo

# Fly 會提示 DNS 記錄設定
# 在域名提供商設定 CNAME 或 A record

# 驗證
curl https://demo.yourcompany.com/health
```

### IP 白名單（可選安全加固）

```bash
# 在 fly.toml 中配置（需要 Fly Wireguard）
# [build]
# 自行實作 rate limiter middleware（見 P1-1）
```

---

## 清理與刪除

```bash
# 銷毀 Demo 應用（謹慎操作！）
fly apps destroy erp-demo

# 銷毀 Postgres（先備份！）
fly postgres delete -a erp-demo-db

# 確認操作
fly apps list  # 應無 erp-demo
```

---

## 下一步

- **P2-2**：Feature Catalog（功能清單管理）
  - TenantFeature model
  - Feature check middleware
  - Admin 功能管理分頁

- **P1 系列**：生產加固
  - P1-1：API rate limiter + quota
  - P1-2：Churn SOP
  - P1-3：LINE webhook routing

---

## 資源連結

- [Fly.io 文檔](https://fly.io/docs/)
- [Fly Postgres](https://fly.io/docs/postgres/)
- [Fly 部署指南](https://fly.io/docs/getting-started/deploy/)

