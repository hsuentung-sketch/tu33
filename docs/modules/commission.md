# 業績獎金（commission）模組流程

> v2.15.0 新增。業務薪酬「超賣分潤」月結報表。

## Trigger
- 主管（ADMIN）/ 會計（ACCOUNTING）在後台「業務功能 → 業績獎金」選年月（+ 業務 + 代開發票%）查詢結算。
- 業務（SALES）查自己的當月獎金。

## Scope
- 計算公式：單筆獎金 =（銷貨成交單價 `SalesItem.unitPrice` − 成交時產品售價 `SalesItem.salePriceAtSale`）× `quantity`。
  - `salePriceAtSale` 為成交當下快照（v2.15.0 起寫入）；歷史無快照者 fallback 用「當前 `Product.salePrice`」；連產品都查不到（自由輸入品名 / 產品已刪）→ 用成交價（該筆獎金 0）。
- 因建單時已驗證「成交價不得低於產品售價」（`sales-order.service.resolveItemSalePrices`），單筆獎金恆 ≥ 0。
- 查詢範圍：單一月份（year + month），SalesOrder.orderDate 落於該月、`isDeleted=false`。
- 業務歸屬：`SalesOrder.createdBy`（= Employee.id）。
- 逐張銷貨單列出品項明細與單筆獎金 + 單小計；累計總獎金。
- 代開發票扣除：`deductPct ∈ {0, 8, 10, 13}`，`netAmount = round(totalBonus × (1 − deductPct/100))`。

## 權限
- SALES：強制只看自己（`employeeId` 鎖 `req.employee.id`）。
- ADMIN / ACCOUNTING：可指定 `employeeId`，省略 = 全部業務。
- 其他角色（PURCHASING / VIEWER）：403。

## Acceptance
- 選年月 + 業務 + % → 逐單明細 + 單筆獎金正確；累計 = Σ 單筆；實發 = 累計 ×(1−%)。
- 產品調價後，已有快照的歷史單獎金不變（快照生效）。
- SALES 帳號只回自己的銷貨單；ADMIN 可切換業務 / 看全部。

## Out of scope
- 不提供自訂起訖日期（只按月）。
- 不寫入「已結算」狀態（純報表，不落帳）；未來若要鎖結算另開。
- 不計算公司毛利（用 costPrice）——本模組只算給業務的獎金（用 salePrice）。
- 不自動發放 / 不串接薪資。

## API
- `GET /api/commission/monthly?year=&month=&employeeId=&deductPct=`
