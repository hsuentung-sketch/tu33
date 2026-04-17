-- ============================================================
-- Migration: 修改/刪除 報價單/銷貨單/進貨單 + 公司統編
-- 日期：2026-04-17（二次）
-- 貼到 Supabase SQL Editor 執行
-- ============================================================

-- 1. Tenant 加統編
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "taxId" TEXT;

-- 2. Quotation 軟刪除欄位
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Quotation_tenantId_isDeleted_idx" ON "Quotation"("tenantId","isDeleted");

-- 3. SalesOrder 軟刪除欄位
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "SalesOrder_tenantId_isDeleted_idx" ON "SalesOrder"("tenantId","isDeleted");

-- 4. PurchaseOrder 軟刪除欄位
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_isDeleted_idx" ON "PurchaseOrder"("tenantId","isDeleted");

-- 5. 潤樋實業統編（若 tenant 已存在且 taxId 還沒填才更新）
UPDATE "Tenant"
   SET "taxId" = '62198132'
 WHERE "companyName" LIKE '%潤樋%'
   AND ("taxId" IS NULL OR "taxId" = '');

-- ---------- 驗證 ----------
-- SELECT "id","companyName","taxId" FROM "Tenant";
-- SELECT count(*) FROM "Quotation"     WHERE "isDeleted" = false;
-- SELECT count(*) FROM "SalesOrder"    WHERE "isDeleted" = false;
-- SELECT count(*) FROM "PurchaseOrder" WHERE "isDeleted" = false;
