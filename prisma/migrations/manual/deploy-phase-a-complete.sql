-- ================================================================
-- Phase A Deploy: 完整 DDL 腳本
-- 目標：v2.15.0 (20909c1) → HEAD 整批上 Production
-- 在 Supabase SQL Editor 依序執行
-- ================================================================

-- ============================================================
-- Step 3a: lineUserId 跨 tenant 重複檢查（預期 0 rows）
-- ============================================================

SELECT 'Employee 跨 tenant 重複' AS check_type, "lineUserId", COUNT(DISTINCT "tenantId") AS tenant_count
FROM "Employee"
WHERE "lineUserId" IS NOT NULL
GROUP BY "lineUserId"
HAVING COUNT(DISTINCT "tenantId") > 1;

SELECT 'Customer 跨 tenant 重複' AS check_type, "lineUserId", COUNT(DISTINCT "tenantId") AS tenant_count
FROM "Customer"
WHERE "lineUserId" IS NOT NULL
GROUP BY "lineUserId"
HAVING COUNT(DISTINCT "tenantId") > 1;

-- Step 3b: 確認現有 Employee lineUserId unique index
SELECT indexname FROM pg_indexes WHERE tablename = 'Employee' AND indexname LIKE '%lineUserId%';

-- ============================================================
-- 4a: Accounting Phase A（會計科目 / 期間 / 傳票）
-- ============================================================

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

-- ============================================================
-- 4b: Billing Management（計費方案 / 訂閱 / 事件 / 發票）
-- ============================================================

DO $$ BEGIN CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUALLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BillingEventType" AS ENUM ('SUBSCRIPTION_CREATED', 'PLAN_UPGRADE', 'PLAN_DOWNGRADE', 'RENEWAL', 'CANCELLATION', 'TRIAL_END'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- BillingPlan
CREATE TABLE IF NOT EXISTS "BillingPlan" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "monthlyPrice" NUMERIC(10, 2) NOT NULL,
  "annualPrice" NUMERIC(10, 2) NOT NULL,
  "trialDays"   INTEGER NOT NULL DEFAULT 14,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingPlan_name_key" ON "BillingPlan"("name");
CREATE INDEX IF NOT EXISTS "BillingPlan_isActive_idx" ON "BillingPlan"("isActive");
CREATE INDEX IF NOT EXISTS "BillingPlan_displayOrder_idx" ON "BillingPlan"("displayOrder");

-- PlanFeature
CREATE TABLE IF NOT EXISTS "PlanFeature" (
  "id"        TEXT NOT NULL,
  "planId"    TEXT NOT NULL,
  "feature"   TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlanFeature_planId_feature_key" ON "PlanFeature"("planId", "feature");
CREATE INDEX IF NOT EXISTS "PlanFeature_planId_idx" ON "PlanFeature"("planId");

-- TenantBillingSubscription
CREATE TABLE IF NOT EXISTS "TenantBillingSubscription" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL UNIQUE,
  "planId"            TEXT NOT NULL,
  "billingCycle"      "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
  "isInTrial"         BOOLEAN NOT NULL DEFAULT true,
  "trialEndDate"      TIMESTAMP(3),
  "subscriptionStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "renewalDate"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "autoRenew"         BOOLEAN NOT NULL DEFAULT true,
  "cancellationDate"  TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantBillingSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantBillingSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantBillingSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantBillingSubscription_tenantId_key" ON "TenantBillingSubscription"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantBillingSubscription_planId_idx" ON "TenantBillingSubscription"("planId");
CREATE INDEX IF NOT EXISTS "TenantBillingSubscription_renewalDate_idx" ON "TenantBillingSubscription"("renewalDate");
CREATE INDEX IF NOT EXISTS "TenantBillingSubscription_isInTrial_idx" ON "TenantBillingSubscription"("isInTrial");

-- BillingEvent
CREATE TABLE IF NOT EXISTS "BillingEvent" (
  "id"            TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventType"     "BillingEventType" NOT NULL,
  "oldPlanId"     TEXT,
  "newPlanId"     TEXT,
  "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proratedAmount" NUMERIC(10, 2),
  "description"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantBillingSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BillingEvent_subscriptionId_idx" ON "BillingEvent"("subscriptionId");
CREATE INDEX IF NOT EXISTS "BillingEvent_eventType_idx" ON "BillingEvent"("eventType");
CREATE INDEX IF NOT EXISTS "BillingEvent_effectiveDate_idx" ON "BillingEvent"("effectiveDate");

-- Invoice
CREATE TABLE IF NOT EXISTS "Invoice" (
  "id"                   TEXT NOT NULL,
  "invoiceNumber"        TEXT NOT NULL UNIQUE,
  "subscriptionId"       TEXT NOT NULL,
  "billingPeriodStart"   TIMESTAMP(3) NOT NULL,
  "billingPeriodEnd"     TIMESTAMP(3) NOT NULL,
  "amount"               NUMERIC(10, 2) NOT NULL,
  "discount"             NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "tax"                  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "total"                NUMERIC(10, 2) NOT NULL,
  "status"               "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "issuedAt"             TIMESTAMP(3),
  "paidAt"               TIMESTAMP(3),
  "dueDate"              TIMESTAMP(3) NOT NULL,
  "notes"                TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantBillingSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_subscriptionId_billingPeriodStart_key" ON "Invoice"("subscriptionId", "billingPeriodStart");
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");
CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX IF NOT EXISTS "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX IF NOT EXISTS "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

-- 初始化預設計費方案
INSERT INTO "BillingPlan" ("id", "name", "monthlyPrice", "annualPrice", "trialDays", "displayOrder", "updatedAt")
VALUES
  ('plan_' || gen_random_uuid()::text, 'Free', 0, 0, 14, 0, CURRENT_TIMESTAMP),
  ('plan_' || gen_random_uuid()::text, 'Starter', 29.99, 299.90, 14, 1, CURRENT_TIMESTAMP),
  ('plan_' || gen_random_uuid()::text, 'Professional', 99.99, 999.90, 14, 2, CURRENT_TIMESTAMP),
  ('plan_' || gen_random_uuid()::text, 'Enterprise', 299.99, 2999.90, 30, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- ============================================================
-- 4c: Version Management（版本歷史 / 租戶版本訂閱）
-- ============================================================

CREATE TABLE IF NOT EXISTS "VersionHistory" (
  "id"             TEXT NOT NULL,
  "version"        TEXT NOT NULL,
  "releaseDate"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supportedUntil" TIMESTAMP(3) NOT NULL,
  "features"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"          TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VersionHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VersionHistory_version_key" ON "VersionHistory"("version");
CREATE INDEX IF NOT EXISTS "VersionHistory_releaseDate_idx" ON "VersionHistory"("releaseDate");
CREATE INDEX IF NOT EXISTS "VersionHistory_supportedUntil_idx" ON "VersionHistory"("supportedUntil");

CREATE TABLE IF NOT EXISTS "TenantVersionSubscription" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "currentVersion"  TEXT NOT NULL,
  "latestVersion"   TEXT NOT NULL,
  "upgradeDeadline" TIMESTAMP(3),
  "lastCheckedAt"   TIMESTAMP(3),
  "lastUpgradedAt"  TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantVersionSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantVersionSubscription_tenantId_key" ON "TenantVersionSubscription"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantVersionSubscription_upgradeDeadline_idx" ON "TenantVersionSubscription"("upgradeDeadline");

ALTER TABLE "TenantVersionSubscription"
  DROP CONSTRAINT IF EXISTS "TenantVersionSubscription_tenantId_fkey";
ALTER TABLE "TenantVersionSubscription"
  ADD CONSTRAINT "TenantVersionSubscription_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "VersionHistory" ("id", "version", "releaseDate", "supportedUntil", "isActive", "updatedAt")
VALUES (
  'version_default_' || gen_random_uuid()::text,
  '1.0.0',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '30 days',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("version") DO NOTHING;

-- ============================================================
-- 4d: Advanced Billing（年繳 / 暫停 / 使用量）
-- ============================================================

ALTER TABLE "BillingPlan" ADD COLUMN IF NOT EXISTS "initialSetupPrice" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "BillingPlan" ADD COLUMN IF NOT EXISTS "yearlyPrice" DECIMAL(10,2);
ALTER TABLE "BillingPlan" ADD COLUMN IF NOT EXISTS "yearlyDiscountPercent" DECIMAL(5,2) DEFAULT 0;

ALTER TABLE "TenantBillingSubscription" ADD COLUMN IF NOT EXISTS "setupFeeCharged" BOOLEAN DEFAULT FALSE;
ALTER TABLE "TenantBillingSubscription" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP;
ALTER TABLE "TenantBillingSubscription" ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP;
ALTER TABLE "TenantBillingSubscription" ADD COLUMN IF NOT EXISTS "suspendReason" TEXT;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "overdueSince" TIMESTAMP;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "overdueFeeApplied" DECIMAL(10,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS "UsageMetric" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL,
  "value" DECIMAL(12,2) NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("subscriptionId") REFERENCES "TenantBillingSubscription"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "UsageMetric_subscriptionId_metricType" ON "UsageMetric"("subscriptionId", "metricType");
CREATE INDEX IF NOT EXISTS "UsageMetric_recordedAt" ON "UsageMetric"("recordedAt");

CREATE TABLE IF NOT EXISTS "UsageLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL,
  "monthlyLimit" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL,
  FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE CASCADE,
  UNIQUE ("planId", "metricType")
);
CREATE INDEX IF NOT EXISTS "UsageLimit_planId" ON "UsageLimit"("planId");

CREATE TABLE IF NOT EXISTS "UsageOverageRate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL,
  "ratePerUnit" DECIMAL(10,4) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL,
  FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE CASCADE,
  UNIQUE ("planId", "metricType")
);
CREATE INDEX IF NOT EXISTS "UsageOverageRate_planId" ON "UsageOverageRate"("planId");

-- BillingEventType 新增事件類型（程式碼有用到，必須加）
ALTER TYPE "BillingEventType" ADD VALUE IF NOT EXISTS 'SUSPENSION';
ALTER TYPE "BillingEventType" ADD VALUE IF NOT EXISTS 'RESUME';
ALTER TYPE "BillingEventType" ADD VALUE IF NOT EXISTS 'OVERDUE_NOTICE';
ALTER TYPE "BillingEventType" ADD VALUE IF NOT EXISTS 'USAGE_OVERAGE';

-- ============================================================
-- 4e: lineUserId Composite Unique（P0-2）
-- ============================================================

DROP INDEX IF EXISTS "Employee_lineUserId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_tenantId_lineUserId_key"
  ON "Employee"("tenantId", "lineUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_tenantId_lineUserId_key"
  ON "Customer"("tenantId", "lineUserId");

-- ============================================================
-- 4f: 缺少的 model（f552f91 schema 有但 migration 漏）
-- ============================================================

-- VersionChangeType enum
DO $$ BEGIN CREATE TYPE "VersionChangeType" AS ENUM ('UPGRADE', 'ROLLBACK', 'AUTO_UPGRADE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VersionUpgradeLog
CREATE TABLE IF NOT EXISTS "VersionUpgradeLog" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "fromVersion" TEXT NOT NULL,
  "toVersion"   TEXT NOT NULL,
  "changeType"  "VersionChangeType" NOT NULL,
  "operatorId"  TEXT,
  "reason"      TEXT,
  "commitHash"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VersionUpgradeLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VersionUpgradeLog_tenantId_idx"
  ON "VersionUpgradeLog"("tenantId");
CREATE INDEX IF NOT EXISTS "VersionUpgradeLog_tenantId_createdAt_idx"
  ON "VersionUpgradeLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "VersionUpgradeLog_changeType_idx"
  ON "VersionUpgradeLog"("changeType");

ALTER TABLE "VersionUpgradeLog"
  DROP CONSTRAINT IF EXISTS "VersionUpgradeLog_tenantId_fkey";
ALTER TABLE "VersionUpgradeLog"
  ADD CONSTRAINT "VersionUpgradeLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BillingSubscriptionLog
CREATE TABLE IF NOT EXISTS "BillingSubscriptionLog" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "fromPlanId"   TEXT,
  "fromPlanName" TEXT,
  "toPlanId"     TEXT,
  "toPlanName"   TEXT,
  "operatorId"   TEXT,
  "reason"       TEXT,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingSubscriptionLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BillingSubscriptionLog_tenantId_idx"
  ON "BillingSubscriptionLog"("tenantId");
CREATE INDEX IF NOT EXISTS "BillingSubscriptionLog_tenantId_createdAt_idx"
  ON "BillingSubscriptionLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "BillingSubscriptionLog_action_idx"
  ON "BillingSubscriptionLog"("action");

ALTER TABLE "BillingSubscriptionLog"
  DROP CONSTRAINT IF EXISTS "BillingSubscriptionLog_tenantId_fkey";
ALTER TABLE "BillingSubscriptionLog"
  ADD CONSTRAINT "BillingSubscriptionLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 4g: 新增欄位（v2.16.0 + P0-P2）
-- ============================================================

-- v2.16.0 業績獎金
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "taxDeductRate" DECIMAL(5,2);
ALTER TABLE "SalesItem" ADD COLUMN IF NOT EXISTS "costAtSale" DECIMAL(12,2);

-- P1-1 Churn soft-delete
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;

-- P0-V Version commitHash（VersionUpgradeLog 已含 commitHash，此行為安全冪等）
-- ALTER TABLE "VersionUpgradeLog" ADD COLUMN IF NOT EXISTS "commitHash" TEXT;

-- Version subscription previousVersion
ALTER TABLE "TenantVersionSubscription" ADD COLUMN IF NOT EXISTS "previousVersion" TEXT;

-- ============================================================
-- 驗證：列出所有新建表確認存在
-- ============================================================

SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'ChartOfAccount', 'FiscalPeriod', 'JournalEntry', 'JournalLine',
  'BillingPlan', 'PlanFeature', 'TenantBillingSubscription', 'BillingEvent', 'Invoice',
  'VersionHistory', 'TenantVersionSubscription', 'VersionUpgradeLog', 'BillingSubscriptionLog',
  'UsageMetric', 'UsageLimit', 'UsageOverageRate'
)
ORDER BY tablename;
