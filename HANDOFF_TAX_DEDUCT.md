# 稅務扣抵功能交接文件

完成日期：2026-06-12

## 修改檔案清單

| 檔案 | 說明 |
|------|------|
| `prisma/schema.prisma` | JournalEntry 加 4 個稅務欄位 |
| `docs/migrations/add-tax-deduct-fields.sql` | DB migration SQL |
| `src/modules/accounting/expense/expense.service.ts` | TAX_RULES + calcTaxDeduction + quickExpense 自動帶入稅務 |
| `src/modules/accounting/journal/journal.service.ts` | JournalEntryInput + create() 支援稅務欄位 |
| `src/modules/accounting/reports.service.ts` | 新增 taxDeductionReport、pettyCashMonthly |
| `src/modules/accounting/accounting.router.ts` | 新增兩個報表 endpoint |
| `public/admin/app.js` | 傳票列表加稅務欄、新增稅務扣抵/零用金月結分頁 |

---

## Step 1 — Supabase SQL Editor

貼入執行（檔案在 `docs/migrations/add-tax-deduct-fields.sql`）：

```sql
ALTER TABLE "JournalEntry"
  ADD COLUMN IF NOT EXISTS "vatDeductType"  TEXT,
  ADD COLUMN IF NOT EXISTS "vatInputAmount" NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS "deductibleVat"  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS "withholdingTax" NUMERIC(12,2);
```

## Step 2 — 本機執行

```powershell
cd D:\Claude\ERP

# 重新產生 Prisma client（型別需包含新欄位）
npx prisma generate

# TypeScript 編譯檢查
npx tsc --noEmit

# 確認 0 error 後部署
./scripts/fly-deploy.ps1
# 或
fly deploy --build-arg GIT_COMMIT=$(git rev-parse --short HEAD)
```

## Step 3 — 驗證

部署後開後台：

1. 會計 → 傳票 — 確認表格有「進項稅額 / 可扣抵 / 扣繳稅額 / 扣抵類型」欄
2. 會計 → 稅務扣抵 — 選年度查詢，確認報表載入
3. 會計 → 零用金月結 — 選月份查詢，確認月初/月末餘額顯示

---

## 新功能說明

### 稅務規則（TAX_RULES）

| 科目 | 扣抵類型 | 說明 |
|------|----------|------|
| 6101 薪資 | withholding | 代扣繳 5%（月薪 ≤ 88,501 免扣） |
| 6201 租金 | deductible | 有統一發票可扣抵；自然人租金另計扣繳 10% |
| 6211 水電 | deductible | 台電/台水帳單，5% 進項可扣抵 |
| 6221 文具 | deductible | 三聯發票，5% 進項可扣抵 |
| 6231 交通 | review | ETC/高鐵可扣；計程車手寫收據不可扣，需逐筆審核 |
| 6241 郵電 | deductible | 中華電信等帳單，5% 進項可扣抵 |
| 6291 雜項 | review | 交際費有上限；其他需人工判斷 |

### 進項稅額計算

```
進項稅額 = 含稅金額 × 5 / 105
```

### 新 API

```
GET /api/accounting/reports/tax-deduction?year=2026&month=6
GET /api/accounting/reports/petty-cash-monthly?year=2026&month=6
```
