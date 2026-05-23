# ERP 項目交接備忘錄 → Opus 4.6
**日期**: 2026-05-21  
**交接人**: Haiku  
**目標**: 完成本機開發環境啟動 + 完整部署規劃  

---

## 📊 當前進度概覽

| 階段 | 狀態 | 完成度 |
|------|------|--------|
| P0-1 多租戶隔離 | ✅ 完成 | 100% |
| P0-2 lineUserId 隔離 | ✅ 完成 | 100% |
| P0-3 版本+計費管理 | ✅ 完成 | 100% |
| P2-1 Demo Instance | 🔶 進行中 | 85% |
| P2-2 Feature Catalog | ⏳ 待開始 | 0% |
| P3 完整規劃 | ⏳ 待開始 | 0% |

---

## ✅ 已完成的工作

### 1. TypeScript 編譯
- **狀態**: 成功（只有 3 個 @jest/globals 非關鍵警告）
- **編譯命令**: `npm run build` ✅

### 2. P2-1 Demo Instance 核心代碼
- **已創建檔案**:
  - `src/modules/core/demo/demo.router.ts` — Demo 重置 API
  - `src/scripts/demo-seed.ts` — Demo 資料初始化（20 員工、50 客戶、3 計畫）
  - `.env.demo` — 環境配置模板
  - 文檔: `docs/P2_DEMO_DEPLOYMENT.md`, `docs/P2_DEMO_QUICK_START.md`

- **Demo 資料規格**:
  - 租戶: 某環保公司
  - 計畫: Starter ($99/月) / Professional ($299/月) / Enterprise ($599/月)
  - 員工: 20 人（4 種角色）
  - 客戶: 50 家
  - 銷售訂單: 10 筆
  - 發票: 3 期（當月、上月、上上月）

### 3. 版本管理模組 (P0-3a)
- `src/modules/core/version/version.service.ts` — 版本發布、升級、自動升級、LINE 通知
- 功能: Grace period (30 天)、auto-upgrade cron、租戶通知

### 4. 計費配置管理 (P0-3b)
- `src/modules/core/billing/billing.service.ts` — 訂閱、續訂、計畫變更、發票
- `src/modules/core/billing/billing-advanced.service.ts` — 高級計費邏輯

### 5. 多租戶隔離層
- `src/shared/tenant-isolation.ts` — 4 個隔離驗證函數
- 應用到: 員工、客戶、供應商、銷售、採購、會計、庫存、版本、計費、文件管理

---

## 🔴 當前阻塞點 & 解決方案

### 問題: 應用啟動時數據庫連接失敗
```
Error: Authentication failed against the database server
Location: src/jobs/invoice-boot-check.ts:30
```

### 根本原因
`.env` 中的 `DATABASE_URL` 未配置或無效

### 選定解決方案: 本機 PostgreSQL (開發用)

---

## 🚀 優先事項清單（按優先順序）

### 🔴 P1 - 本週內完成（Blockers）

#### P1.1 本機 PostgreSQL 配置 & 驗證
- **目標**: 讓應用成功啟動並通過數據庫認證
- **步驟**:
  1. 確認本機 PostgreSQL 已安裝並執行中
  2. 創建開發資料庫: `createdb erp_dev`
  3. 編輯 `.env`: `DATABASE_URL="postgresql://user:password@localhost:5432/erp_dev"`
  4. 執行: `npm run migrate:deploy`
  5. 驗證: `npx prisma db seed` 或手動執行 demo-seed

- **預期結果**: 應用啟動無錯誤，cron job 正常調度

#### P1.2 完成 5 分鐘本機啟動流程
```powershell
copy .env.demo .env                              # 複製範本
# 編輯 .env，設定正確的 DATABASE_URL
npm run migrate:deploy                           # 執行遷移
npx ts-node --transpile-only src/scripts/demo-seed.ts  # 初始化 demo 資料
npm run dev                                      # 啟動開發伺服器
# 驗證: curl http://localhost:3000/api/demo/status
```

- **驗證端點**:
  - `GET /api/demo/status` → `{"status":"ok"}`
  - `POST /api/demo/reset` → 重新初始化資料

#### P1.3 更新文檔
- 更新 `docs/P2_DEMO_QUICK_START.md` 包含完整的本機設定步驟
- 新增 `.env.template` 說明每個變數

---

### 🟠 P2 - 本週末完成（核心 P2-1）

#### P2.1 Demo Fly.io 雲端部署規劃
- **目標**: 建立本機→Fly.io 的完整部署流程
- **內容**:
  1. Fly.io app 建置 (`fly.toml` 配置)
  2. PostgreSQL Fly Postgres 附加
  3. 環境變數設定 (生產 secrets)
  4. Database migration 自動化
  5. Demo seed 在雲端初始化
  6. 監控與日誌配置

- **交付物**:
  - 完整的 `fly.toml` 範本
  - `.env.production` 範本
  - 部署檢查清單 (`docs/FLY_DEPLOYMENT_CHECKLIST.md`)
  - 故障排查指南

#### P2.2 Demo API 端點擴充
- 新增 `/api/demo/export` — 匯出 demo 資料為 JSON
- 新增 `/api/demo/metrics` — Demo 資料統計 (租戶數、員工數、交易額等)
- 新增 `/api/demo/seed-config` — 允許自訂 demo 參數 (員工數、客戶數)

#### P2.3 本機開發 DX 改善
- 新增 npm script: `npm run dev:seed` — 自動初始化 demo
- 新增 npm script: `npm run db:reset` — 清除所有資料並重新遷移
- Prettier + ESLint 配置 (TypeScript strict 已啟用)

---

### 🟡 P3 - 下週初開始（P2-2 Feature Catalog 規劃）

#### P3.1 Feature Catalog 資料模型設計
**目標**: 建立計畫功能管理系統 (P2-2)

**新 Schema**:
```prisma
model TenantFeature {
  id String @id
  tenantId String
  tenant Tenant @relation(fields: [tenantId], references: [id])
  feature String  // 'sales', 'purchase', 'accounting' 等
  enabled Boolean
  enabledAt DateTime?
  expiresAt DateTime?  // 功能過期時間 (試用結束後)
  
  @@unique([tenantId, feature])
}

model FeatureLimit {
  id String @id
  featureKey String  // 'order_count_monthly', 'user_count' 等
  planId String
  plan BillingPlan @relation(fields: [planId], references: [id])
  limit Int  // -1 = unlimited
  currentUsage Int
  resetAt DateTime?
}
```

**邏輯**:
1. 訂閱計畫時，自動啟用計畫所含功能
2. 計畫過期/取消時，自動禁用功能
3. Feature check middleware 在每個路由前驗證租戶權限

#### P3.2 Feature Gating Middleware
```typescript
// 使用方式
app.get('/api/sales/orders', featureGate('sales'), handleSalesOrders);
```

- 檢查 TenantFeature.enabled
- 記錄嘗試存取被禁用功能的行為
- 返回 403 Forbidden + 升級建議

#### P3.3 Admin Portal — Feature 管理分頁
- 列出租戶的所有功能狀態
- 手動啟用/禁用功能 (用於測試或特殊協議)
- 查看功能使用量與限制
- 批量啟用/禁用 (針對計畫變更)

---

### 🟢 P4 - 下週(後續規劃)

#### P4.1 Feature Dashboard (P3-1)
- 內部儀表板: 功能採用率、使用趨勢
- 計費影響分析: 各功能對 ARPU 的貢獻度

#### P4.2 定價頁面 & 功能清單 (P3-2)
- 公開網站: 計畫對比表 (功能、價格、限制)
- Feature 說明卡片 (截圖、demo 連結)

#### P4.3 多機架構成本分析 (P3-3)
- DB 分片策略 (按 tenantId)
- 應用層負載均衡配置
- 成本模型: 機器數 vs. 租戶數

---

## 📋 檔案清單 & 檢查點

### 待驗證的檔案
- [ ] `.env.demo` — 確認所有變數都有預設或說明
- [ ] `src/modules/core/version/version.service.ts` — 行 286、333 pushMessage 格式正確
- [ ] `src/scripts/demo-seed.ts` — SalesOrder 欄位完整 (orderNo, createdBy, subtotal, taxAmount)
- [ ] `src/shared/tenant-isolation.ts` — 4 個函數都被正確使用
- [ ] `src/routes/index.ts` — demoRouter 在 authMiddleware 前 mount

### 待創建的檔案
- [ ] `docs/LOCAL_SETUP.md` — 本機開發環境快速起步 (PostgreSQL 安裝指南)
- [ ] `docs/FLY_DEPLOYMENT_CHECKLIST.md` — Fly.io 部署完整檢查清單
- [ ] `.env.template` — 環境變數說明文檔
- [ ] `src/middleware/feature-gate.ts` — Feature gating middleware (P3.2)
- [ ] 遷移檔案: `TenantFeature` & `FeatureLimit` schema (P3.1)

---

## 🔧 Opus 4.6 接下來的工作流

### 立即行動 (今天)
1. **詢問用戶** PostgreSQL 連接字串或幫助本機安裝
2. **配置 .env** 並測試 `npm run migrate:deploy`
3. **執行 demo-seed** 並驗證 demo 端點
4. **確保應用穩定啟動** (`npm run dev`)

### 本週內
5. **更新快速起步文檔** (LOCAL_SETUP.md)
6. **設計 Fly.io 部署流程** (fly.toml, 環境變數)
7. **實施 P2.2 demo API 擴充** (export, metrics, seed-config)

### 下週初
8. **設計 P2-2 Feature Catalog schema & middleware**
9. **實施 TenantFeature & FeatureLimit 模型**
10. **建立 feature-gate middleware 與 admin API**

### 持續
11. **整合現有計費模塊** 與 Feature Catalog (訂閱→功能啟用)
12. **撰寫完整的部署與營運文檔**

---

## 💡 關鍵設計決策

| 決策 | 選項 | 已選 | 理由 |
|------|------|------|------|
| 開發資料庫 | PostgreSQL / SQLite | PostgreSQL | 生產一致性，多租戶隔離驗證 |
| 部署目標 | 本機 / Fly.io / 兩者 | 本機優先 | 快速反覆，本週內上線 |
| Feature Gating | Middleware / Service / 混合 | Middleware | 最簡單，最安全 (catch-all) |
| 計畫與功能關係 | 硬編碼 / 動態表 / 混合 | 動態表 (FeatureLimit) | 支援靈活定價與試驗 |

---

## 📞 需要澄清的事項

請 Opus 4.6 與用戶確認：
1. PostgreSQL 已在本機安裝? (否則需要遠程資料庫或 SQLite 替代)
2. 對 P2-2 Feature Catalog 的功能邊界有其他要求嗎？(例如: 使用量追蹤、合同期限等)
3. Admin Portal 需要完整的 UI 還是只要 API 端點？

---

## 🎯 成功指標

- [ ] 本機應用穩定啟動 (`npm run dev` 無錯誤)
- [ ] Demo 端點正常 (`/api/demo/status` 返回 ok)
- [ ] 完整的本機設定文檔 (新用戶能在 15 分鐘內起動)
- [ ] Fly.io 部署流程文檔化並驗證可行
- [ ] P2-2 Feature Catalog 初始設計與 schema 完成
- [ ] TypeScript strict 模式編譯成功 (0 critical errors)

---

**交接完成日期**: 2026-05-21 20:00 UTC+8  
**Opus 4.6 開始時間**: ASAP
