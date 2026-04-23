# 多租戶模板紀律（硬規則）

本 repo 是 **SaaS 模板**，所有客戶跑**同一個 main branch**。客戶差異**只能**透過配置層表達，不得進程式碼。

違反本檔 = PR 不得合併 = 客戶升級時會出 regression。

---

## 0. 三條鐵則

1. **禁止**在 `src/` 任何檔案出現客戶公司名、特定 tenantId、特定 lineChannelId 的硬編碼。
2. **禁止**開「客戶專用」的 long-lived branch（`huapin-only`、`runtong-custom`）。
3. **禁止**因為一家客戶的需求直接改共用邏輯；必須抽成配置或 feature flag。

違反任一條，PR 一律退回。

---

## 1. 差異應該進哪裡？（決策樹）

差異類型分 **A–F 六級**。先判斷級別，再套對應方案。**命中 E 或 F 以上才需要動 schema / code**；A–C 絕大多數新需求都能吸收。

```
客戶需求跟 template 不同
 │
 ├─ A. 純術語 / 標籤 / 稱呼
 │     例：「供應商」→「處理廠」、「銷貨單」→「出貨單」
 │     → Tenant.settings.docNames.{entity}
 │     → 見 §8 術語本地化
 │     工時 < 1 天
 │
 ├─ B. 參數 / 規則值
 │     例：稅率、付款天數、單號前綴、通知時段、月結 N 天
 │     → Tenant.settings.{key}
 │     工時 < 1 天
 │
 ├─ C. 模組開關
 │     例：客戶不用庫存、不用廢棄物申報、不用 LIFF 報價單
 │     → Tenant.modules 陣列（router 層 guard）
 │     工時 < 1 天
 │
 ├─ D. 同核心實體的流程變體（重疊度 70–95%）
 │     例：A 客戶銷貨要審核、B 客戶直接出
 │          A 客戶收款走月結、B 客戶走預付
 │     → Strategy pattern + FeatureFlag
 │     → 同 repo，不同策略實作；預設 standard，非標 opt-in
 │     工時 1–5 天
 │
 ├─ E. 新增行業特有欄位（重疊度 50–70%）
 │     例：環保業產品要 epaCode / hazardLevel / permitNumber
 │          食品業客戶要有效期追溯 / 批號
 │     → 判斷「所有 tenant 都可能會用嗎？」
 │         · 是 → 主 schema 加欄位（nullable，default null）
 │         · 否 → 用 `Product.attributes` / `Customer.attributes` (JSONB)
 │                + `ProductCategory.attributeSchema` 做行業模板
 │     工時 3–10 天（含 schema 擴充）
 │
 └─ F. 核心業務流程本質不同（重疊度 < 50%）
       例：tu33 = 潤滑油買賣（買進賣出）
           廢棄物處理 = 收料 → 處理 → 再生品銷售（多了「處理」中間態 + EPA 申報 + 許可證）
       例：tu33 = B2B
           零售 POS = B2C 現金找零 / 會員 / 多通路庫存
       → 獨立 repo，獨立 Product
       → 主控 Phase 5+ 做 Product 抽象才納管
       工時：從頭開發
```

### 1.1 量化判準（避免憑感覺落 E/F）

每來一個客戶需求，依下表打分。命中**右欄兩項以上**才另開 repo；否則都應想辦法進 A–E。

| 判準 | 同 template + config/strategy（A–E）| 另開 repo（F）|
|-----|----------------------------------|-------------|
| 新欄位數量 vs 現有欄位 | < 20% | > 50% |
| 需要新 module（非 master/sales/purchase/accounting/inventory）| 1 個以內 | 2 個以上 |
| 業務流程圖節點數差異 | 差 1–2 個 | 差 ≥ 3 個 |
| 法規依循差異 | 無，或可參數化 | 特殊法規（EPA、醫療、金融、GMP）|
| PDF / 報表版型 | 欄位調整即可 | 完全重設計 |
| UI 核心導航 | 一致 | 架構不同 |

### 1.2 歷史決策紀錄（案例）

| 客戶 / 產品 | 級別 | 做法 | 日期 |
|-----------|------|------|------|
| 潤樋實業（主） | 基準 | tu33 原生 | 2026-04 |
| 華品環保工程 | A（術語）| `Tenant.settings.docNames` 把「供應商→處理廠」；無業務流程改動 | 2026-04-21 |
| （曾 spike 過）華品獨立 repo | — | 已 DEPRECATED，改走 A 級。設計（ProductCategory.attributeSchema / waste 模組）保留供未來 E 級參考 | 2026-04-21 |

新客戶進來先回來更新這張表。連續出現「同一類需求無法落 A–E」時，代表可能要認真評估 F 級。

## 2. 對照表：下列需求的正解

| 需求 | ❌ 錯誤做法 | ✅ 正確做法 |
|------|------------|------------|
| 客戶 A 稅率 0%、B 5% | `if (tenantId === 'A') taxRate = 0` | `Tenant.settings.taxRate` |
| 客戶 A PDF 加公司章 | 在 pdf-generator 讀公司名判斷 | `Tenant.settings.stampImageUrl` |
| 客戶 A 不用庫存模組 | `if (tenantId === 'A') skip inventory` | `Tenant.modules` 不含 `inventory`；router 層 guard |
| 客戶 A 要簽核流程 | 寫新的 approval flow 預設啟用 | 寫功能 + `FeatureFlag('approval_flow', tenantId)` |
| 客戶 A 把「銷貨單」改叫「出貨單」 | grep replace 改 template | `settings.docNames.salesOrder` |
| 客戶 A 付款日算法特殊 | `if (tenantId === 'A') use new formula` | 抽 strategy；`settings.paymentFormula = 'A'` |
| 客戶 A 的 LINE channel | `if (tenant.id === 'A') token = '...'` | `Tenant.lineAccessToken`（已有） |

---

## 3. PR Review 檢核清單

每次 PR 合併前，reviewer（或自己）逐項打勾。任一項 ❌ → 退回。

### 3.1 程式碼掃描（自動）

```powershell
cd D:\Claude\ERP

# A. 沒有客戶公司名硬編碼
Select-String -Path "src\**\*.ts" -Pattern "華品|潤樋|huapin|runtong" -SimpleMatch
# 期望結果：0 筆（若出現在測試資料以外的地方就 ❌）

# B. 沒有 tenantId 字串比較
Select-String -Path "src\**\*.ts" -Pattern "tenantId === ['`"]|tenantId == ['`"]" 
# 期望結果：0 筆

# C. 沒有 companyName 字串比較
Select-String -Path "src\**\*.ts" -Pattern "companyName === ['`"]|companyName == ['`"]"
# 期望結果：0 筆

# D. 沒有硬編碼 LINE channel ID / secret
Select-String -Path "src\**\*.ts" -Pattern "channelId.*=.*['`"][0-9]{10,}['`"]" 
# 期望結果：0 筆
```

### 3.2 人工 review 要看的點

- [ ] 新增的欄位/邏輯對**所有**客戶有意義嗎？
- [ ] 若某客戶不需要，是否走 `Tenant.modules` 或 `FeatureFlag` 開關？
- [ ] `Tenant.settings` schema 有更新文件（本 repo `docs/tenant-settings.md`）嗎？
- [ ] 有沒有寫「預設值」？（新欄位必須 backward compatible：舊 tenant 沒設也能跑）
- [ ] Migration 有 default？（不能讓沒設值的舊 tenant 在升級瞬間壞掉）
- [ ] PR 描述有沒有寫「此改動如何影響不同 tenant」？

### 3.3 branch 檢查

```powershell
git branch -a
# 期望：只有 main + 短命 feature branch；不該有 <customer>-only 這種
```

---

## 4. 紅旗信號（出現就停下）

看到以下跡象，立刻暫停動手，回到決策樹：

- 🚩 commit message 出現「for 華品」「針對客戶 X」
- 🚩 出現 `TODO: 這裡以後別家客戶可能不適用`
- 🚩 一個 bug fix 只改某客戶的狀況，沒想到對其他客戶的影響
- 🚩 想開新 branch 避免影響別家 → 99% 是錯的，應該用 feature flag
- 🚩 發現需要查「這個邏輯目前只有哪家客戶跑得到」
- 🚩 客戶提需求時第一反應是「好，我來改 code」而不是「可以用 config 嗎」
- 🚩 在 DB 看到某 tenant 的 settings 有**超過 10 個**特殊欄位其他家都沒用 → 重新檢討是否該抽象為 feature flag / 新模組

---

## 5. 正確心態

- **每個新需求**，先問：「這個可以用 `Tenant.settings` 解決嗎？」
- **每個 PR**，先問：「這個改動所有客戶都要嗎？若某客戶不要，怎麼關？」
- **每次拒絕客戶**，先想：「是不是我沒抽象好，硬做其實能用 config 解？」
- **每次升級**，心裡要確信：「所有客戶跑同一個 commit，我只需要測一次」

如果你發現最近 3 個 PR 都出現 `if (tenantId === 'X')`，代表架構在腐化，停下來做一次重構。

---

## 6. 例外管理

真的有極少數需求無法抽象（例如某產業特殊法規），允許以 strategy pattern 實作並標記：

```ts
// strategies/payment-formula/taiwanese-standard.ts
// strategies/payment-formula/special-forestry.ts  ← 僅適用林業客戶

// Tenant.settings.paymentFormula = 'special-forestry'
```

條件：
1. Strategy interface 明確；新 strategy 不改共用程式
2. 預設用 standard；非標只能被 tenant opt-in
3. 每個非標 strategy 檔頭寫清楚：為什麼需要、適用哪類客戶、何時可以廢除

---

## 7. 何時檢討本檔

- 每次重大架構改動（新增模組、改 schema）
- 每季做一次「多租戶健檢」：grep 一次本檔 §3.1 的掃描指令
- 有新開發者加入時強制閱讀

本檔變動紀錄放在 `CHANGELOG.md`。

---

## 8. 術語本地化（docNames 字典）

§1.A 的標準作法。所有「行業術語可能被客戶改叫」的字面都走字典，不硬編碼。

### 8.1 資料結構

`Tenant.settings.docNames`（JSON 物件，optional；未設 → 走預設）：

```json
{
  "supplier": "處理廠",
  "supplierShort": "廠商",
  "customer": "客戶",
  "purchaseOrder": "進料單",
  "purchaseOrderShort": "進料",
  "salesOrder": "出售單",
  "salesOrderShort": "出售",
  "quotation": "報價單",
  "product": "料號",
  "receivable": "應收款",
  "payable": "應付款"
}
```

**鍵的命名規則**：
- 全小寫、camelCase
- 短版加 `Short` 後綴（LINE Flex button 20 字元上限用）
- 動詞 / 名詞分開放：`purchaseOrder`（名詞）vs `createPurchaseOrder`（動詞）

完整支援鍵清單另外維護在 `docs/tenant-settings.md`（§ docNames 段）。

### 8.2 使用方式

#### Server 端

集中放 `src/shared/i18n.ts`：

```ts
const DEFAULT_DOC_NAMES: Record<string, string> = {
  supplier: '供應商',
  supplierShort: '供應商',
  customer: '客戶',
  purchaseOrder: '進貨單',
  purchaseOrderShort: '進貨',
  salesOrder: '銷貨單',
  salesOrderShort: '銷貨',
  quotation: '報價單',
  product: '產品',
  receivable: '應收帳款',
  payable: '應付帳款',
};

export function resolveLabel(
  tenantSettings: unknown,
  key: string,
  fallback?: string,
): string {
  const custom = (tenantSettings as any)?.docNames?.[key];
  if (typeof custom === 'string' && custom.trim()) return custom;
  return DEFAULT_DOC_NAMES[key] ?? fallback ?? key;
}
```

用法（同步、不需 await）：

```ts
import { resolveLabel } from '../../shared/i18n.js';

// PDF title
const title = resolveLabel(tenant.settings, 'salesOrder'); // '出售單' or '銷貨單'

// LINE Flex text
const btnLabel = resolveLabel(tenant.settings, 'supplierShort');
```

#### Client 端（admin / LIFF）

後端在登入 session 回傳時把 `docNames` 一併帶過去，前端 `window.DOC_NAMES` 當 map：

```js
// public/admin/app.js 啟動
const docNames = window.DOC_NAMES || {};
const label = (key, fallback) => docNames[key] || fallback || key;

// render
h3.textContent = label('supplier', '供應商'); // 「處理廠」or「供應商」
```

### 8.3 不要這樣用

- ❌ 不要把**業務邏輯的 key** 放進去：`docNames.statusPending = '處理中'` — 那是狀態 enum，應該在程式裡決定，不是用戶可改
- ❌ 不要在**資料庫欄位名**上用 docNames：DB schema 永遠用英文 `Supplier`，UI / PDF 才走 resolveLabel
- ❌ 不要放長句：docNames 只收短名詞；「請填寫供應商資料」這類句子用 template string 組合
- ❌ 不要在 hot path 重複算：若單一請求多次用，cache 在 request context 一次

### 8.4 維護

- 新增可本地化的鍵 → 同步更新 `DEFAULT_DOC_NAMES` + `docs/tenant-settings.md`
- 要廢除某鍵 → 先確認沒有 tenant 的 `settings.docNames` 有自訂；再兩版相容後移除
- 預設值不可輕易改 — 會影響所有未自訂的 tenant

### 8.5 測試

覆蓋三種情境：

1. tenant 完全沒設 settings → 顯示預設（`供應商`）
2. tenant 設了 `docNames.supplier = '處理廠'` → 顯示「處理廠」
3. tenant 設了空字串 `docNames.supplier = ''` → fallback 到預設（不顯示空白）
