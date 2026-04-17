-- ============================================================
-- Migration: ShortLink + ProductDocument + ErrorLog
-- 日期：2026-04-17
-- 執行方式：複製整段貼到 Supabase → SQL Editor → Run
-- （本地 DATABASE_URL 走 pgbouncer 6543 port 不支援 DDL）
-- ============================================================

-- ---------- 1. ShortLink（短連結） ----------
CREATE TABLE IF NOT EXISTS "ShortLink" (
  "id"         TEXT PRIMARY KEY,
  "code"       TEXT NOT NULL UNIQUE,
  "tenantId"   TEXT,
  "target"     TEXT NOT NULL,
  "label"      TEXT,
  "kind"       TEXT,
  "expiresAt"  TIMESTAMP(3),
  "hits"       INTEGER NOT NULL DEFAULT 0,
  "createdBy"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ShortLink_tenantId_createdAt_idx" ON "ShortLink"("tenantId","createdAt");
CREATE INDEX IF NOT EXISTS "ShortLink_expiresAt_idx" ON "ShortLink"("expiresAt");

-- ---------- 2. ProductDocument + DocumentType enum ----------
DO $$ BEGIN
  CREATE TYPE "DocumentType" AS ENUM ('PDS','SDS','DM','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProductDocument" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "type"        "DocumentType" NOT NULL,
  "fileName"    TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "fileSize"    INTEGER NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "uploadedBy"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductDocument_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProductDocument_tenantId_idx" ON "ProductDocument"("tenantId");
CREATE INDEX IF NOT EXISTS "ProductDocument_productId_type_idx" ON "ProductDocument"("productId","type");

-- ---------- 3. ErrorLog ----------
CREATE TABLE IF NOT EXISTS "ErrorLog" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT,
  "userId"     TEXT,
  "level"      TEXT NOT NULL DEFAULT 'error',
  "source"     TEXT NOT NULL,
  "message"    TEXT NOT NULL,
  "stack"      TEXT,
  "requestId"  TEXT,
  "route"      TEXT,
  "statusCode" INTEGER,
  "context"    JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ErrorLog_tenantId_createdAt_idx" ON "ErrorLog"("tenantId","createdAt");
CREATE INDEX IF NOT EXISTS "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");
CREATE INDEX IF NOT EXISTS "ErrorLog_level_createdAt_idx" ON "ErrorLog"("level","createdAt");

-- ---------- 驗證 ----------
-- 貼完後執行以下可確認三張表都建成：
-- SELECT tablename FROM pg_tables WHERE tablename IN ('ShortLink','ProductDocument','ErrorLog');
