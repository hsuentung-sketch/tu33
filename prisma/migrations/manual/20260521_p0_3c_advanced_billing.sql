-- P0-3c Advanced Billing Features
-- 1. 年繳優惠 + 首次設計價格
-- 2. 逾期發票管理
-- 3. 訂閱暫停/恢復
-- 4. 使用量計費

-- ============================================================
-- 1. BillingPlan: 年繳優惠 + 首次設計價格
-- ============================================================
ALTER TABLE "BillingPlan" ADD COLUMN "initialSetupPrice" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "BillingPlan" ADD COLUMN "yearlyPrice" DECIMAL(10,2);
ALTER TABLE "BillingPlan" ADD COLUMN "yearlyDiscountPercent" DECIMAL(5,2) DEFAULT 0;

COMMENT ON COLUMN "BillingPlan"."initialSetupPrice" IS '首次設計費（一次性）';
COMMENT ON COLUMN "BillingPlan"."yearlyPrice" IS '年繳價格（月繳價格乘以12減去折扣）';
COMMENT ON COLUMN "BillingPlan"."yearlyDiscountPercent" IS '年繳折扣百分比（e.g., 10% 折扣）';

-- ============================================================
-- 2. TenantBillingSubscription: 暫停/恢復 + 首次費用追蹤
-- ============================================================
ALTER TABLE "TenantBillingSubscription" ADD COLUMN "setupFeeCharged" BOOLEAN DEFAULT FALSE;
ALTER TABLE "TenantBillingSubscription" ADD COLUMN "suspendedAt" TIMESTAMP;
ALTER TABLE "TenantBillingSubscription" ADD COLUMN "suspendedUntil" TIMESTAMP;
ALTER TABLE "TenantBillingSubscription" ADD COLUMN "suspendReason" TEXT;

COMMENT ON COLUMN "TenantBillingSubscription"."setupFeeCharged" IS '是否已收首次設計費';
COMMENT ON COLUMN "TenantBillingSubscription"."suspendedAt" IS 'SAAS 主控台設定的暫停時間';
COMMENT ON COLUMN "TenantBillingSubscription"."suspendedUntil" IS '暫停結束日期（為 null 表示無限期暫停）';
COMMENT ON COLUMN "TenantBillingSubscription"."suspendReason" IS '暫停原因（e.g., 逾期、主動申請等）';

-- ============================================================
-- 3. Invoice: 逾期追蹤
-- ============================================================
ALTER TABLE "Invoice" ADD COLUMN "overdueSince" TIMESTAMP;
ALTER TABLE "Invoice" ADD COLUMN "reminderSentAt" TIMESTAMP;
ALTER TABLE "Invoice" ADD COLUMN "overdueFeeApplied" DECIMAL(10,2) DEFAULT 0;

COMMENT ON COLUMN "Invoice"."overdueSince" IS '首次逾期時間';
COMMENT ON COLUMN "Invoice"."reminderSentAt" IS '催款通知寄送時間';
COMMENT ON COLUMN "Invoice"."overdueFeeApplied" IS '逾期費（可選）';

-- ============================================================
-- 4. UsageMetric: 使用量記錄
-- ============================================================
CREATE TABLE "UsageMetric" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL, -- e.g., "api_calls", "storage_gb", "user_count"
  "value" DECIMAL(12,2) NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("subscriptionId") REFERENCES "TenantBillingSubscription"("id") ON DELETE CASCADE
);

CREATE INDEX "UsageMetric_subscriptionId_metricType" ON "UsageMetric"("subscriptionId", "metricType");
CREATE INDEX "UsageMetric_recordedAt" ON "UsageMetric"("recordedAt");

-- ============================================================
-- 5. UsageLimit: 計畫使用量限制
-- ============================================================
CREATE TABLE "UsageLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL, -- e.g., "api_calls", "storage_gb", "user_count"
  "monthlyLimit" DECIMAL(12,2) NOT NULL, -- 月度上限
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL,
  FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE CASCADE,
  UNIQUE ("planId", "metricType")
);

CREATE INDEX "UsageLimit_planId" ON "UsageLimit"("planId");

-- ============================================================
-- 6. UsageOverageRate: 超額費率
-- ============================================================
CREATE TABLE "UsageOverageRate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL, -- e.g., "api_calls", "storage_gb", "user_count"
  "ratePerUnit" DECIMAL(10,4) NOT NULL, -- 每單位超額費用
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL,
  FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE CASCADE,
  UNIQUE ("planId", "metricType")
);

CREATE INDEX "UsageOverageRate_planId" ON "UsageOverageRate"("planId");

-- ============================================================
-- 7. BillingEventType 新增事件類型
-- ============================================================
-- NOTE: PostgreSQL enum 擴展（假設使用 Prisma 自動更新 enum）
-- ALTER TYPE "BillingEventType" ADD VALUE 'SUSPENSION';
-- ALTER TYPE "BillingEventType" ADD VALUE 'RESUME';
-- ALTER TYPE "BillingEventType" ADD VALUE 'OVERDUE_NOTICE';
-- ALTER TYPE "BillingEventType" ADD VALUE 'USAGE_OVERAGE';
