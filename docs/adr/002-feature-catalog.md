# ADR-002: Feature Catalog（功能目錄與模組存取控制）

- **狀態**: 已採納
- **日期**: 2026-05-23
- **決策者**: Platform Team

## 背景

SaaS ERP 平台提供多個計費方案（Starter / Professional / Enterprise），每個方案應包含不同的模組存取權限和用量上限。目前所有租戶都能存取所有 API 端點，沒有模組級存取控制。

## 決策

以「計畫驅動」的模組級 feature gate 實現功能控制，搭配用量硬擋機制。

### 設計原則

1. **模組級粒度**：以現有模組為單位（sales, purchase, accounting, inventory），不拆子功能
2. **計畫驅動**：功能由 BillingPlan 的 PlanFeature 決定，不需額外 TenantFeature 表
3. **超額硬擋**：用量達上限直接回 403 + 升級提示，不允許超額使用

### 既有 Schema（無異動）

已有三個 model 足以支撐：

- **PlanFeature** — `planId` + `feature`（模組名）+ `enabled`
- **UsageLimit** — `planId` + `metricType` + `monthlyLimit`（-1 = 無限制）
- **UsageOverageRate** — 預留超額計費（本次不使用，硬擋模式）

### 新增程式碼

| 檔案 | 用途 |
|------|------|
| `src/middleware/feature-gate.ts` | `requireModule(moduleName)` middleware，查租戶計畫的 PlanFeature |
| `src/modules/core/feature/feature.service.ts` | 租戶功能查詢、用量檢查（`checkUsageLimit`） |
| `src/modules/core/feature/feature.router.ts` | `GET /api/tenant/features`（租戶端） |
| Platform router 新增 | `GET /api/platform/features`（主控台全租戶總覽） |

### Feature Gate 掛載

```typescript
// routes/index.ts
apiRouter.use('/quotations', requireModule('sales'), quotationRouter);
apiRouter.use('/sales-orders', requireModule('sales'), salesOrderRouter);
apiRouter.use('/purchase-orders', requireModule('purchase'), purchaseOrderRouter);
apiRouter.use('/receivables', requireModule('accounting'), receivableRouter);
apiRouter.use('/inventory', requireModule('inventory'), inventoryRouter);
// ... 其餘模組同理
```

不擋的路由：employees、products、customers、suppliers、tenant、versions、billing（這些屬基礎/核心功能）。

### 用量檢查

由各 service 在建立資源前呼叫：

```typescript
import { checkUsageLimit } from '../core/feature/feature.service.js';

// 在 createEmployee 前
await checkUsageLimit(tenantId, 'employee_count');
```

支援的 metricType：`employee_count`、`customer_count`、`monthly_order_count`、`product_count`。

### 快取策略

Feature gate middleware 查詢結果快取 60 秒（記憶體 Map），計畫變更時可透過 `clearFeatureCache(tenantId)` 清除。

### Demo 計畫配置

| 方案 | 模組 | 員工 | 客戶 | 月訂單 | 產品 |
|------|------|------|------|--------|------|
| Starter | sales, customers | 5 | 50 | 100 | 50 |
| Professional | sales, purchase, customers, inventory, accounting | 30 | 500 | 1000 | 500 |
| Enterprise | 全模組 | 無限制 | 無限制 | 無限制 | 無限制 |

## 考慮過的替代方案

### A. 功能級粒度（子功能開關）

優點：更精細的定價策略。缺點：目前只有 4 個模組，拆更細增加管理複雜度且用戶難以理解。待模組數增長後再考慮。

### B. 租戶覆寫（TenantFeature 表）

優點：可對單一租戶手動開關功能（VIP 試用）。缺點：多一張表、多一層查詢。目前用計畫驅動即可，未來有需要時再加。

### C. 軟擋 + 警告

優點：用戶體驗較好。缺點：grace period 邏輯複雜，且可能造成帳務爭議。硬擋搭配清楚的錯誤訊息和升級引導更直接。

## 後果

- 現有租戶若計畫的 PlanFeature 未設定，所有模組 API 會被擋 → 需確保 seed / 計畫建立時一併設定 PlanFeature
- Feature gate 增加每次請求的查詢成本 → 用 60 秒快取緩解
- 前端需處理 403 回應，顯示升級提示而非通用錯誤

## 限制與已知風險

- **不擋 LINE Bot webhook**：LINE 訊息處理走獨立路徑，不經 feature gate。若需限制 LINE 功能，需在 bot handler 另外檢查
- **快取一致性**：計畫變更後最長 60 秒內舊快取仍生效。可接受的延遲
- **用量計算即時性**：`monthly_order_count` 等指標是即時 count 查詢，高並發時可能有短暫計數誤差
