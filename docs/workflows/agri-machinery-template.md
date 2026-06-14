# 農業機械販售維修業 — 工作流程

## 1. 零件銷售

**Trigger**: 業務在 LINE 輸入產品關鍵字或「品名 數量 單價」
**Scope**: sales handler -> sales-order service -> AR auto-create

Steps:
1. 業務選擇客戶（LINE session 綁定 partyId）
2. 搜尋產品 -> Flex carousel 顯示牌價 + 折扣價 + 上次成交價
3. 選擇產品 -> 確認品項卡（品名、數量、單價）
4. 加入更多品項或送出銷貨單
5. 系統建立 SalesOrder + SalesItem + AR（若 arAutoCreate=true）

Acceptance: 折扣價依 customer.priceTier 自動計算、postback price 用折後價

## 2. 新機販售 + 序號登記

**Trigger**: 銷貨單含 category=NEW_MACHINE 的產品
**Scope**: sales-order -> machine-record（Session 2 實作）

Steps:
1. 銷貨單成立後，系統提示登記機台序號
2. 輸入 serialNumber、warrantyStartAt、warrantyEndAt
3. 建立 MachineRecord（關聯 salesOrderId + productId）
4. 序號全租戶唯一（@@unique([tenantId, serialNumber])）

Out of scope: 保固到期自動通知（Session 4 排程）

## 3. 二手機整備

**Trigger**: 管理者在 Admin 建立 RefurbishOrder
**Scope**: refurbish-order service（Session 3 實作）

Steps:
1. 選擇待整備的二手機（Product where category=USED_MACHINE）
2. 建立 RefurbishOrder（status=IN_PROGRESS）
3. 逐筆新增 RefurbishOrderItem（零件 + 用量 + 單價）
4. 系統自動扣庫存（InventoryReason=REFURBISH_OUT）
5. 完成整備 -> status=COMPLETED -> 自動計算 Product.refurbishCost
6. 二手機 salePrice = purchaseCost + refurbishCost + margin

Out of scope: 整備工時追蹤

## 4. 客戶分級定價

**Trigger**: Admin 設定 customer.priceTier
**Scope**: pricing.ts -> sales handler -> Flex card

Steps:
1. Admin 在客戶編輯畫面設定價格級距（1-5）
2. LINE 產品搜尋時查 customer.priceTier
3. Flex card 顯示牌價 + 折扣價（tier > 1 時）+ tier badge
4. 選擇產品 postback 帶折後價
5. 業務可手動覆寫單價（不強制折扣價）

Tier 定義:
- 1: 一般（牌價 100%）
- 2: 常客（9折）
- 3: 熟客（8折）
- 4: 職業客戶（7折）
- 5: 五金客戶（6折）

## 5. 應收帳款發票類型

**Trigger**: 管理者在 AR 編輯畫面設定 invoiceType
**Scope**: receivable service + router

Steps:
1. 銷貨單產生 AR 時 invoiceType=null（未開立）
2. 管理者編輯 AR -> 設定 invoiceType（RECEIPT 或 TAX_INVOICE）
3. AR 列表可依 invoiceType 篩選（含「未開立」=none）
4. 電子發票自動開立待 ECPay 串接（Session 3 評估）

Out of scope: ECPay 串接、自動開立邏輯
