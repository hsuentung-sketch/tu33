# Module Keys — 合法模組 key 與用量指標對照

> 用途：ERP feature gate（`requireModule`）、`BillingPlan.PlanFeature.feature`、
> `Tenant.modules`、CP（Saas control panel）`Plan.modules` / template-registry
> 四處必須用**同一組 key**。本檔為唯一真相來源（P2-fee）。
>
> 來源：`src/middleware/feature-gate.ts`、`src/routes/index.ts`、
> `src/modules/core/feature/feature.service.ts`、ADR-002。

## 功能模組 key（`PlanFeature.feature` / `Tenant.modules`）

| key | feature gate? | 對應 API 路由 | 說明 |
|---|---|---|---|
| `sales` | ✅ 擋 | `/quotations`、`/sales-orders`、`/commission` | 銷售：報價單、銷貨單、業績獎金 |
| `purchase` | ✅ 擋 | `/purchase-orders` | 進貨 |
| `accounting` | ✅ 擋 | `/receivables`、`/payables`、`/einvoices`、`/einvoice-number-pools`、`/einvoice-allowances`、`/accounting` | 會計：應收、應付、電子發票、總帳 |
| `inventory` | ✅ 擋 | `/inventory` | 庫存 |
| `customers` | ⛔ 不擋 | `/customers` | 客戶主檔（基礎功能，可列入方案但路由不 gate） |
| `suppliers` | ⛔ 不擋 | `/suppliers` | 供應商主檔（基礎功能，路由不 gate） |

**永遠不 gate 的基礎/核心路由**（不需列入方案、所有租戶皆可用）：
`employees`、`products`、`customers`、`suppliers`、`visit-logs`、`tenant`、
`versions`、`billing`、`features`、`platform`、`auth`。

> 註：`customers` / `suppliers` 雖列為合法 key（方案可包含、用於用量上限與展示），
> 但其 API 路由目前**不**掛 `requireModule`（屬基礎主檔）。若未來要對它們做模組級
> 收費，再於 `routes/index.ts` 補 gate。

## 用量指標 key（`UsageLimit.metricType`）

| key | 計算（`feature.service.getCurrentUsage`） | 標籤 |
|---|---|---|
| `employee_count` | 啟用中員工數 | 員工數 |
| `customer_count` | 客戶數 | 客戶數 |
| `monthly_order_count` | 當月銷貨單數 | 每月訂單數 |
| `monthly_invoice_count` | 當月發票數 | 每月發票數 |
| `product_count` | 產品數 | 產品數 |

`monthlyLimit = -1` 表示無限制。

## Demo 方案配置（ADR-002）

| 方案 | modules | employee | customer | monthly_order | product |
|---|---|---|---|---|---|
| Starter | `sales`, `customers` | 5 | 50 | 100 | 50 |
| Professional | `sales`, `purchase`, `customers`, `inventory`, `accounting` | 30 | 500 | 1000 | 500 |
| Enterprise | 全模組 | -1 | -1 | -1 | -1 |

## 對齊檢查清單（新增模組 / 改 key 時）

1. `routes/index.ts` — 若要 gate，掛 `requireModule('<key>')`
2. `feature.service.ts` — 若有用量上限，`getCurrentUsage` / `metricLabel` 加 metric key
3. CP `seed-tenant.ts` / template-registry `knownModules[].key` — 用同一組 key
4. 本檔（`docs/module-keys.md`）— 更新表格

> ⚠️ key 不一致會造成：CP 建客戶選的模組 → ERP feature gate 認不得 → 該模組 API 全 403。
