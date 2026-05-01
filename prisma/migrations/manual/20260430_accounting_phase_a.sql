-- v2.5.0 Phase A 會計模組 — 在 Supabase SQL Editor 執行
--
-- 4 個 model：ChartOfAccount / FiscalPeriod / JournalEntry / JournalLine
-- 跑完才能用 npx prisma generate 後的 client。
--
-- 新增完不會自動產分錄（Tenant.settings.accounting.enabled 預設 false），
-- 在後台「會計」頁按「啟用」才會種子預設科目 + 建立期間 + 開帳。

-- ChartOfAccount
CREATE TABLE IF NOT EXISTS "ChartOfAccount" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "level"       INTEGER NOT NULL DEFAULT 1,
  "parentId"    TEXT,
  "type"        TEXT NOT NULL,
  "normalSide"  TEXT NOT NULL,
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChartOfAccount_tenantId_code_key"
  ON "ChartOfAccount"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "ChartOfAccount_tenantId_type_idx"
  ON "ChartOfAccount"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "ChartOfAccount_tenantId_parentId_idx"
  ON "ChartOfAccount"("tenantId", "parentId");

ALTER TABLE "ChartOfAccount"
  DROP CONSTRAINT IF EXISTS "ChartOfAccount_tenantId_fkey";
ALTER TABLE "ChartOfAccount"
  ADD CONSTRAINT "ChartOfAccount_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChartOfAccount"
  DROP CONSTRAINT IF EXISTS "ChartOfAccount_parentId_fkey";
ALTER TABLE "ChartOfAccount"
  ADD CONSTRAINT "ChartOfAccount_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FiscalPeriod
CREATE TABLE IF NOT EXISTS "FiscalPeriod" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "year"      INTEGER NOT NULL,
  "period"    INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate"   TIMESTAMP(3) NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'open',
  "closedAt"  TIMESTAMP(3),
  "closedBy"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FiscalPeriod_tenantId_year_period_key"
  ON "FiscalPeriod"("tenantId", "year", "period");
CREATE INDEX IF NOT EXISTS "FiscalPeriod_tenantId_status_idx"
  ON "FiscalPeriod"("tenantId", "status");

ALTER TABLE "FiscalPeriod"
  DROP CONSTRAINT IF EXISTS "FiscalPeriod_tenantId_fkey";
ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- JournalEntry
CREATE TABLE IF NOT EXISTS "JournalEntry" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "entryNo"      TEXT NOT NULL,
  "entryDate"    TIMESTAMP(3) NOT NULL,
  "periodId"     TEXT NOT NULL,
  "description"  TEXT NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'manual',
  "sourceId"     TEXT,
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "postedAt"     TIMESTAMP(3),
  "postedBy"     TEXT,
  "reversedAt"   TIMESTAMP(3),
  "reversedBy"   TEXT,
  "reversedById" TEXT,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_tenantId_entryNo_key"
  ON "JournalEntry"("tenantId", "entryNo");
CREATE INDEX IF NOT EXISTS "JournalEntry_tenantId_status_idx"
  ON "JournalEntry"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "JournalEntry_tenantId_entryDate_idx"
  ON "JournalEntry"("tenantId", "entryDate");
CREATE INDEX IF NOT EXISTS "JournalEntry_tenantId_source_sourceId_idx"
  ON "JournalEntry"("tenantId", "source", "sourceId");

ALTER TABLE "JournalEntry"
  DROP CONSTRAINT IF EXISTS "JournalEntry_tenantId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalEntry"
  DROP CONSTRAINT IF EXISTS "JournalEntry_periodId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- JournalLine
CREATE TABLE IF NOT EXISTS "JournalLine" (
  "id"           TEXT NOT NULL,
  "entryId"      TEXT NOT NULL,
  "sequence"     INTEGER NOT NULL,
  "accountId"    TEXT NOT NULL,
  "debit"        DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "credit"       DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "description"  TEXT,
  "departmentId" TEXT,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX IF NOT EXISTS "JournalLine_accountId_idx" ON "JournalLine"("accountId");

ALTER TABLE "JournalLine"
  DROP CONSTRAINT IF EXISTS "JournalLine_entryId_fkey";
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  DROP CONSTRAINT IF EXISTS "JournalLine_accountId_fkey";
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
