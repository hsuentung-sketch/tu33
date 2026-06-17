# 交易紀錄查詢（Transaction History）

## Trigger
- **客戶交易紀錄**：管理員/業務在後台客戶列表或 LINE 查詢選單，點選「交易紀錄」
- **產品客戶查詢**：管理員在後台產品列表或 LINE 查詢選單，點選「客戶紀錄」

## Scope

### 功能 1：客戶交易紀錄
- 輸入：customerId
- 輸出：該客戶所有銷貨單明細（orderDate, orderNo, productName, quantity, unitPrice, amount）
- 排序：orderDate DESC
- 過濾：isDeleted = false
- 權限：SALES 只看自己建立的訂單，ADMIN 看全部
- 後台：modal 表格 + 分頁
- LINE：Flex Message 最近 10 筆明細

### 功能 2：產品客戶查詢
- 輸入：productId → 取 Product.name → 查 SalesItem.productName
- 輸出：購買過該產品的客戶清單（orderDate, customerName, quantity, unitPrice, amount）
- 排序：orderDate DESC
- 過濾：isDeleted = false
- 權限：同上
- 後台：modal 表格 + 分頁
- LINE：Flex Message 最近 10 筆

## Acceptance Criteria
1. 後台客戶列表 → 點「交易紀錄」→ modal 顯示該客戶所有非刪除銷貨明細
2. 後台產品列表 → 點「客戶紀錄」→ modal 顯示購買過此產品的客戶與交易資訊
3. LINE 查詢選單新增「客戶交易紀錄」「產品客戶查詢」→ Flex Message 回覆
4. SALES 角色在 API 只能查看自己 createdBy 的訂單
5. `npx tsc --noEmit` 通過

## Out of Scope
- 進貨單（PurchaseOrder）的交易紀錄（本次只做銷貨）
- 匯出 Excel / PDF
- 跨租戶查詢
