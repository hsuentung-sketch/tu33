-- P0-3a 版本管理模型
-- VersionHistory：版本記錄（支持寬限期）
-- TenantVersionSubscription：租戶版本訂閱（自動升級追蹤）

-- VersionHistory
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

-- TenantVersionSubscription
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

-- Add foreign key
ALTER TABLE "TenantVersionSubscription"
  DROP CONSTRAINT IF EXISTS "TenantVersionSubscription_tenantId_fkey";
ALTER TABLE "TenantVersionSubscription"
  ADD CONSTRAINT "TenantVersionSubscription_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Initialize subscriptions for existing tenants (all at latest if it exists)
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
