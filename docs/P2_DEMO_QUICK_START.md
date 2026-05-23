# P2-1 Demo Instance 快速啟動

---

## 5 分鐘快速啟動（本地開發）

### 1️⃣ 準備環境

```bash
cd ~/path/to/ERP

# 複製 demo 環境設定
cp .env.demo .env

# 編輯 .env 中的 DATABASE_URL 為你的本地 PostgreSQL
# 例：postgresql://postgres:password@localhost:5432/erp_demo
```

### 2️⃣ 初始化資料庫

```bash
# 執行遷移
npm run migrate:deploy

# 執行 demo seed 腳本（自動創建租戶、員工、客戶、計畫等）
npx ts-node src/scripts/demo-seed.ts
```

### 3️⃣ 啟動應用

```bash
npm run dev

# 輸出應為：
# ERP server running on 0.0.0.0:3000
# Environment: development
```

### 4️⃣ 驗證

```bash
# 檢查 Demo 狀態
curl http://localhost:3000/api/demo/status

# 預期輸出：
# {
#   "environment": "development",
#   "isDemoAvailable": true,
#   "resetApiAvailable": true,
#   "demoTenantId": "demo_eco_company_001",
#   "timestamp": "2026-05-21T10:30:00.000Z"
# }
```

### 5️⃣ 重置 Demo 資料

任何時候重新初始化：

```bash
# HTTP 請求
curl -X POST http://localhost:3000/api/demo/reset

# 或直接執行腳本
npx ts-node src/scripts/demo-seed.ts
```

---

## 🚀 部署到 Fly.io（10 分鐘）

### 前置條件

```bash
# 安裝 Fly CLI
curl -L https://fly.io/install.sh | sh

# 登入 Fly.io
fly auth login

# 確認 git 已提交
git add .
git commit -m "P2-1: Demo instance setup"
git push origin main
```

### 一鍵部署

```bash
# 第一次部署
fly apps create erp-demo
fly postgres create --name erp-demo-db --region nrt

# 設定環境變數
fly secrets set NODE_ENV=demo -a erp-demo
fly secrets set DATABASE_URL="postgres://..." -a erp-demo
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" -a erp-demo

# 部署應用
fly deploy -a erp-demo

# 驗證
curl https://erp-demo.fly.dev/api/demo/status
```

### 初始化 Demo 資料

```bash
# 觸發 demo reset API
curl -X POST https://erp-demo.fly.dev/api/demo/reset

# 查看日誌（驗證執行成功）
fly logs -a erp-demo | tail -20
```

---

## 📊 Demo 實例包含什麼？

| 資源 | 數量 | 詳情 |
|------|------|------|
| **租戶** | 1 | 某環保公司（demo_eco_company_001） |
| **員工** | 20 | ADMIN (5) / SALES (5) / PURCHASING (5) / ACCOUNTING (5) |
| **客戶** | 50 | 製造、批發、零售、服務等產業 |
| **計畫** | 3 | Starter / Professional / Enterprise |
| **訂閱** | 1 | Professional 月繳（自動續訂） |
| **版本** | 4 | v1.0.0 → v3.0.0（展示升級流程） |
| **銷售訂單** | 10 | 不同狀態（DRAFT / CONFIRMED / SHIPPED / CLOSED） |
| **發票** | 3 | 當月、上月、上上月（展示計費週期） |

---

## 🔗 API 端點

### Demo 管理

```
GET  /api/demo/status        — 查詢演示實例狀態
POST /api/demo/reset         — 重置所有演示資料（清理 + 重新初始化）
```

### 認證（試用）

```
GET  /api/me                 — 當前員工身份（需 JWT token）
```

### 計費相關（展示用）

```
GET  /api/billing/plans      — 查詢所有計畫
GET  /api/billing/me         — 查詢訂閱狀態
```

---

## 🔒 演示帳號

### 預設員工

| 員工 ID | 名稱 | 角色 | 郵箱 |
|---------|------|------|------|
| E0001 | 員工 1 | ADMIN | employee1@ecoco.demo |
| E0002 | 員工 2 | SALES | employee2@ecoco.demo |
| ... | ... | ... | ... |

**注意：** 演示中的帳號無 LINE 登入。實際系統中使用 LINE ID 驗證。

---

## ⚠️ 常見問題

### Q: 如何每次重新開始都是乾淨的資料？

```bash
# 自動重置
curl -X POST http://localhost:3000/api/demo/reset

# 或手動執行
npx ts-node src/scripts/demo-seed.ts
```

### Q: Demo 實例可以用作生產嗎？

**不可以。** Demo 實例設計用於：
- 展示功能
- 內部測試
- 產品演示

生產部署應：
- 使用生產 DATABASE_URL
- 設定強大的 JWT_SECRET
- 配置真實的 LINE Bot credentials
- 使用 SMTP 寄送真實郵件
- 設定完整的監控告警

### Q: 如何清空演示資料？

```bash
# 方式 1：使用 API
curl -X POST http://localhost:3000/api/demo/reset

# 方式 2：手動刪除租戶
# 進入 Prisma Studio
npx prisma studio

# 刪除租戶 demo_eco_company_001（級聯刪除所有相關資料）

# 方式 3：重新執行 seed 腳本
npm run seed:demo
```

### Q: 如何自訂演示資料？

編輯 `src/scripts/demo-seed.ts`：

```typescript
// 修改租戶名稱
const DEMO_TENANT_NAME = '自訂公司名稱';

// 修改員工數量、計畫配置等
// 然後重新執行 seed

npx ts-node src/scripts/demo-seed.ts
```

---

## 📋 部署檢查清單

- [ ] `npm run build` 成功
- [ ] `npm test` 通過
- [ ] `git push` 已提交
- [ ] `.env.demo` 已複製為 `.env`（本地）或設定 `fly secrets`（Fly）
- [ ] PostgreSQL 資料庫已創建
- [ ] 執行 `npm run migrate:deploy` 成功
- [ ] 執行 `npm run seed:demo` 成功
- [ ] `curl /api/demo/status` 返回正確響應
- [ ] `curl -X POST /api/demo/reset` 成功

---

## 📚 相關文件

- **詳細部署指南**：`docs/P2_DEMO_DEPLOYMENT.md`
- **P0 完成總結**：`IMPLEMENTATION_SUMMARY_P0_COMPLETE.md`
- **Seed 腳本**：`src/scripts/demo-seed.ts`
- **Demo Router**：`src/modules/core/demo/demo.router.ts`

---

## 🎯 下一步

1. **P2-2**：Feature Catalog（功能清單系統）
   - 實作 TenantFeature model
   - Feature check middleware
   - Admin 功能管理分頁

2. **P1 系列**：生產加固
   - API rate limiter + quota
   - Churn 處理 SOP
   - 多租戶 LINE webhook routing

3. **P3 系列**：前端儀表板
   - Feature 推薦面板
   - 定價頁面
   - 多機架構規劃

