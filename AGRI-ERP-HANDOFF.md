# 農機 ERP — Claude Code 實作交接文件

**產生日期**：2026-06-13  
**基底 repo**：https://github.com/hsuentung-sketch/tu33（潤樋實業 LINE Bot ERP）  
**新租戶**：宗佑農機（slug: `agri`，以下簡稱「農機模板」）  

本文件是 Phase 1 的完整實作依據。照著順序做，每個 section 都有 Acceptance Criteria。

---

## 0. 原則（務必遵守）

- 本 repo 是**多租戶 SaaS 模板**，農機客製化一律走 `Tenant.settings` / `Tenant.modules`，不得在 `src/` 寫死任何客戶資訊
- Schema 異動必須同步：migration → ORM → service → router → 前端
- 詳細規則見 `CLAUDE.md` 跨 project 技術鐵則 + `docs/multi-tenant-rules.md`

---

## 1. Schema 異動

### 1-a. Product — 新增欄位

```prisma
model Product {
  // ... 現有欄位 ...
  shippingFee   Decimal?  @default(0) @db.Decimal(10,2)
  laborFee      Decimal?  @default(0) @db.Decimal(10,2)
  category      ProductCategory @default(PART)
}

enum ProductCategory {
  PART          // 零件
  NEW_MACHINE   // 新機
  USED_MACHINE  // 二手機
  SERVICE       // 服務/工時
  OTHER
}
```

### 1-b. Customer — 新增欄位

```prisma
model Customer {
  // ... 現有欄位 ...
  priceTier     Int       @default(1)   // 1=牌價 2=9折 3=8折 4=7折 5=6折
}
```

### 1-c. MachineRecord — 新表（新機序號）

```prisma
model MachineRecord {
  id              String   @id @default(cuid())
  tenantId        String
  salesOrderId    String?  // 關聯銷貨單（若已建單）
  productId       String
  serialNumber    String
  warrantyStartAt DateTime
  warrantyEndAt   DateTime
  registeredBy    String   // employeeId
  registeredAt    DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant     Tenant     @relation(fields: [tenantId], references: [id])
  product    Product    @relation(fields: [productId], references: [id])
}
```

### 1-d. RefurbishOrder — 新表（二手機整備工單）

```prisma
model RefurbishOrder {
  id            String   @id @default(cuid())
  tenantId      String
  usedMachineId String   // productId of USED_MACHINE
  status        RefurbishStatus @default(IN_PROGRESS)
  note          String?
  totalCost     Decimal  @default(0) @db.Decimal(10,2)
  createdBy     String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  tenant      Tenant               @relation(fields: [tenantId], references: [id])
  usedMachine Product              @relation(fields: [usedMachineId], references: [id])
  items       RefurbishOrderItem[]
}

model RefurbishOrderItem {
  id               String  @id @default(cuid())
  refurbishOrderId String
  productId        String  // 零件 productId
  quantity         Int
  unitCost         Decimal @db.Decimal(10,2)

  refurbishOrder RefurbishOrder @relation(fields: [refurbishOrderId], references: [id])
  product        Product        @relation(fields: [productId], references: [id])
}

enum RefurbishStatus {
  IN_PROGRESS
  COMPLETED
  CANCELLED
}
```

同時在 `Product` 加：
```prisma
refurbishCost   Decimal  @default(0) @db.Decimal(10,2)  // 累計整備成本
purchaseCost    Decimal? @db.Decimal(10,2)               // 收購進價（二手機用）
```

### 1-e. AR 發票類型 — 新增欄位

```prisma
model AccountReceivable {
  // ... 現有欄位 ...
  invoiceType     InvoiceType?   // null=未開立
  invoiceNumber   String?
  invoiceIssuedAt DateTime?
}

enum InvoiceType {
  RECEIPT         // 電子收據
  TAX_INVOICE     // 電子發票（ECPay）
}
```

### Migration SOP

因 Supabase pooler 不支援 DDL，**在 Supabase SQL Editor 手動執行**：

```sql
-- Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shippingFee" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "laborFee" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'PART';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "refurbishCost" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "purchaseCost" DECIMAL(10,2);

-- Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "priceTier" INTEGER NOT NULL DEFAULT 1;

-- AccountReceivable
ALTER TABLE "AccountReceivable" ADD COLUMN IF NOT EXISTS "invoiceType" TEXT;
ALTER TABLE "AccountReceivable" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "AccountReceivable" ADD COLUMN IF NOT EXISTS "invoiceIssuedAt" TIMESTAMPTZ;

-- 新表（完整 CREATE TABLE，詳見 prisma migrate diff 產出）
-- MachineRecord, RefurbishOrder, RefurbishOrderItem
```

---

## 2. 客戶分級定價

### 2-a. 折扣對照表

```typescript
// src/shared/pricing.ts
export const PRICE_TIER_DISCOUNT: Record<number, number> = {
  1: 1.0,   // 一般客戶 — 牌價
  2: 0.9,   // 常客
  3: 0.8,   // 熟客
  4: 0.7,   // 職業客戶
  5: 0.6,   // 五金客戶
};

export function applyTierDiscount(listPrice: number, tier: number): number {
  const rate = PRICE_TIER_DISCOUNT[tier] ?? 1.0;
  return Math.round(listPrice * rate);
}
```

### 2-b. 建單時套用

在 `sales-order.service.ts` 的 `createSalesOrder` 中：
1. 查詢 `customer.priceTier`
2. 每個品項若未手動指定 `unitPrice`，則 `unitPrice = applyTierDiscount(product.salePrice, priceTier)`
3. LINE chat 顯示：「依客戶分級（熟客 8 折）自動套價，可輸入 數量 單價 手動覆蓋」

### 2-c. Flex 搜尋卡片顯示

現有 `sales.handler.ts` 的產品 Flex 卡片需加：
- 右上角 badge 顯示客戶等級折扣（例：「熟客 -20%」）
- 建議售價欄位改為「建議售價（折後）：$XXX」

---

## 3. 電子收據 / 電子發票

### 3-a. 流程

```
AR 建立
  ↓
後台 / LINE chat 操作者點「開立收據」或「開立發票」
  ↓
[收據路徑] → 產生電子收據 PDF → 更新 AR.invoiceType=RECEIPT
[發票路徑] → 呼叫 ECPay B2B 開立 API → 回傳發票號碼 → 更新 AR.invoiceType=TAX_INVOICE
```

### 3-b. ECPay 整合

```typescript
// src/modules/accounting/invoice/ecpay.service.ts
// 測試環境: https://einvoice-stage.ecpay.com.tw
// 正式環境: https://einvoice.ecpay.com.tw

interface EcpayInvoiceParams {
  MerchantID: string;
  RelateNumber: string;     // 自訂單號（AR.id）
  CustomerName: string;
  CustomerIdentifier: string; // 統編，若無填 ''
  SalesAmount: number;
  ItemName: string;
  ItemCount: string;
  ItemUnit: string;
  ItemPrice: string;
  ItemTaxType: string;      // '1'=應稅
  TaxType: '1' | '2' | '3'; // 1=應稅 2=零稅 3=免稅
}
```

環境變數：
```
ECPAY_MERCHANT_ID=
ECPAY_HASH_KEY=
ECPAY_HASH_IV=
ECPAY_ENV=stage   # stage | production
```

### 3-c. 帳務查詢分離

`GET /api/accounting/receivable?invoiceType=RECEIPT`  
`GET /api/accounting/receivable?invoiceType=TAX_INVOICE`  
`GET /api/accounting/receivable?invoiceType=none`（未開立）

後台 `應收帳款` 頁新增 Tab：全部 / 電子收據 / 電子發票 / 未開立

---

## 4. 二手機整備流程

### 4-a. 收購入庫

- 走現有**進貨單**（`PurchaseOrder`）流程，`Product.category = USED_MACHINE`
- 進價存入 `Product.purchaseCost`（每次收購可覆蓋更新，或依需求開新 Product）

### 4-b. 建立整備工單（LINE chat）

觸發詞：`整備 <二手機品名>` 或後台操作

```
整備流程（LINE）：
1. 「整備 割草機二手 CG411」→ 搜尋 USED_MACHINE 並建 RefurbishOrder
2. 「加零件 火星塞 3 @50」→ 加 RefurbishOrderItem，扣庫存
3. 「整備完成」→ RefurbishOrder.status=COMPLETED，更新 Product.refurbishCost
```

### 4-c. 成本計算

```typescript
// 整備完成時
const totalRefurbishCost = order.items.reduce(
  (sum, item) => sum + item.quantity * item.unitCost, 0
);
await prisma.product.update({
  where: { id: usedMachineId },
  data: {
    refurbishCost: totalRefurbishCost,
    // 建議售價提示 = purchaseCost + refurbishCost，業務自行定價
  }
});
// 同時扣除各零件庫存（Inventory 表）
```

### 4-d. Acceptance Criteria

- [ ] 收購二手機後庫存顯示 1 台，進價正確
- [ ] 整備工單建立後零件庫存自動扣除
- [ ] 整備完成後 `refurbishCost` 正確累計
- [ ] 後台二手機列表顯示「進價 + 整備成本 = 底價」

---

## 5. 新機序號 OCR 登記

### 5-a. LINE 觸發流程

```
銷售完成（或獨立登記）→
使用者傳送指令：「登記序號」
  → bot 回覆：「請拍機身序號貼紙照片」
  → 使用者傳圖
  → Google Vision OCR → 擷取序號字串
  → bot 回覆確認：「序號：{serialNumber}，保固開始日期？（格式：2026/06/13）」
  → 使用者回覆日期
  → 詢問保固期（月數，預設 12）
  → 建立 MachineRecord
```

### 5-b. OCR 實作

```typescript
// src/line/handlers/machine-register.handler.ts
import { ImageAnnotatorClient } from '@google-cloud/vision';

async function extractSerialFromImage(imageContent: Buffer): Promise<string | null> {
  const client = new ImageAnnotatorClient({ apiKey: process.env.GOOGLE_VISION_API_KEY });
  const [result] = await client.textDetection({ image: { content: imageContent } });
  const text = result.textAnnotations?.[0]?.description ?? '';
  // 序號通常是字母+數字組合，長度 6-20，嘗試 regex 提取
  const match = text.match(/[A-Z0-9]{6,20}/g);
  return match ? match[0] : text.trim().split('\n')[0];
}
```

### 5-c. Acceptance Criteria

- [ ] 拍照後 OCR 成功回傳序號（至少 80% 準確率）
- [ ] `MachineRecord` 建立，保固到期日正確計算
- [ ] LINE bot 可查詢「機器序號 {serial}」取得保固資訊

---

## 6. Excel 匯入腳本

### 6-a. 客戶匯入（下游.xls）

```typescript
// src/tools/import-agri-customers.ts
// 每個分頁名 = 客戶名稱
// 分頁資料用來判斷客戶分級（五金行 → priceTier=5，鎮公所/軍營 → priceTier=1 等）
// 手動對照規則：

const TIER_RULES: Record<string, number> = {
  '五金': 5,        // 分頁名含「五金」→ tier 5
  '農機': 2,        // 農機行 → tier 2
  '機車': 3,        // 機車行 → tier 3
};
// 其餘預設 tier=1
```

分頁 → 客戶名稱對照（18 個）：
`勝育農機`, `益興`, `玉山.亘恩`, `曜薪`, `東泰農機`, `鴻昌.豐隆五金`, `建順五金`, `曾先生`, `永盛機車.國昌機車行.健成機車`, `洋浤五金`, `宥成五金`, `永泰五金`, `鋸樹.喬鼎`, `園藝`, `頭份竹南鎮公所`, `消毒公司`, `軍營`, `金華農藥行`

### 6-b. 零件產品匯入（宗佑引擎零件.xls + 宗佑零件 小引擎.xls）

統一欄位對應：
| Excel 欄位 | Product 欄位 |
|-----------|-------------|
| 廠商 | `supplierName`（或對應 Supplier.id）|
| 廠牌/型號 | `model` |
| 品名/規格 | `name` |
| 數量 | 初始庫存 `stock` |
| 成本 / X | `costPrice` |
| 小賣 / S / 牌價 | `salePrice`（tier 1 牌價）|
| 分頁名 | 標籤 `tag`（機型分類）|

引擎零件 + 小引擎共約 **30 個分頁，估計 1,000-1,500 筆產品**，建議分批匯入（每批 100 筆，附進度顯示）。

---

## 7. 後台介面調整（`public/admin/`）

### 7-a. 產品頁

- 新增 `shippingFee`、`laborFee` 欄位
- 新增 `category` 下拉（零件 / 新機 / 二手機 / 服務）
- 二手機顯示「底價」= `purchaseCost + refurbishCost`

### 7-b. 客戶頁

- 新增 `priceTier` 下拉（一般 / 常客 / 熟客 / 職業客戶 / 五金客戶）

### 7-c. 應收帳款頁

- 每筆 AR 末尾加操作按鈕：「開立收據」「開立發票」
- 新增 Tab 篩選（全部 / 電子收據 / 電子發票 / 未開立）

### 7-d. 二手機整備（新頁）

- 路由 `#/refurbish`
- 列表顯示 USED_MACHINE 清單，含進價、整備成本、底價
- 每筆可點入查看整備工單明細

### 7-e. 序號管理（新頁）

- 路由 `#/machines`
- 依序號查詢、依客戶篩選、顯示保固狀態（正常 / 即將到期 / 已過期）

---

## 8. 新增環境變數

```
# ECPay 電子發票
ECPAY_MERCHANT_ID=
ECPAY_HASH_KEY=
ECPAY_HASH_IV=
ECPAY_ENV=stage

# Google Vision（若未設定，序號登記改走手動輸入）
GOOGLE_VISION_API_KEY=（已有）
```

---

## 9. Phase 1 完成標準

| 功能 | 驗收條件 |
|------|---------|
| 產品欄位 | 後台新增產品可填運費/工時，存取正確 |
| 客戶分級 | 建銷貨單時自動套折扣，LINE 顯示折扣說明 |
| 電子收據 | AR 可開立收據，PDF 產出，帳務可篩選 |
| 電子發票 | ECPay stage 環境開立成功，號碼回寫 AR |
| 二手機整備 | 整備工單扣庫存、累計成本、後台底價顯示正確 |
| 序號 OCR | LINE 拍照辨識序號，MachineRecord 建立 |
| Excel 匯入 | 客戶 18 筆、零件產品 1000+ 筆無錯誤匯入 |

---

## 10. 實作順序建議

1. Schema migration（最先，其他功能都依賴）
2. `applyTierDiscount` + Customer priceTier（快，影響建單流程）
3. MachineRecord + OCR handler（獨立模組，不影響現有流程）
4. RefurbishOrder + 整備流程（依賴庫存模組）
5. AR 發票類型欄位 + ECPay service（最後，需申請 ECPay 測試帳號）
6. Excel 匯入腳本
7. 後台 UI 調整

---

## 附錄：Excel 檔案位置

匯入時從這裡讀取（已在 uploads 資料夾，正式環境另行存放）：
- `下游.xls` — 客戶 + 歷史銷售
- `宗佑引擎零件.xls` — 引擎零件產品
- `宗佑零件 小引擎.xls` — 小引擎零件產品
- `營業額.xls` — 歷史月營業額（**不匯入系統，僅供參考**）
