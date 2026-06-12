-- Migration: 加稅務扣抵欄位至 JournalEntry
-- 執行位置：Supabase SQL Editor（因 pgbouncer port 不支援 DDL）
-- 對應 Prisma schema 版本：加了 vatDeductType / vatInputAmount / deductibleVat / withholdingTax

ALTER TABLE "JournalEntry"
  ADD COLUMN IF NOT EXISTS "vatDeductType"  TEXT,
  ADD COLUMN IF NOT EXISTS "vatInputAmount" NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS "deductibleVat"  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS "withholdingTax" NUMERIC(12,2);

COMMENT ON COLUMN "JournalEntry"."vatDeductType"  IS 'deductible=進項可扣 / non_deductible=不可扣 / withholding=應扣繳 / review=需人工審核';
COMMENT ON COLUMN "JournalEntry"."vatInputAmount" IS '進項稅額（含稅金額 × 5/105）';
COMMENT ON COLUMN "JournalEntry"."deductibleVat"  IS '可扣抵進項稅額（交際費=0）';
COMMENT ON COLUMN "JournalEntry"."withholdingTax" IS '扣繳稅額（薪資/租金代扣）';
