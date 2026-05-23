-- P0-3b 計費配置管理模型
-- BillingPlan：計費方案
-- PlanFeature：方案功能對應
-- TenantBillingSubscription：租戶訂閱
-- BillingEvent：計費事件
-- Invoice：發票

-- Enums
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUALLY');
CREATE TYPE "BillingEventType" AS ENUM ('SUBSCRIPTION_CREATED', 'PLAN_UPGRADE', 'PLAN_DOWNGRADE', 'RENEWAL', 'CANCELLATION', 'TRIAL_END');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');

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
