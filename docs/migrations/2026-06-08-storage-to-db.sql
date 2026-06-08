-- v2.16.1: Storage migration -- Supabase Storage -> Neon PostgreSQL
-- Product/supplier documents stored as fileData (bytea) in DB.
-- Run BEFORE deploying v2.16.1.
--
-- Existing rows keep fileData=NULL (legacy uploads lost with Supabase project).
-- Downloads for NULL fileData return 410 "please re-upload".

ALTER TABLE "ProductDocument" ADD COLUMN IF NOT EXISTS "fileData" BYTEA;
ALTER TABLE "SupplierDocument" ADD COLUMN IF NOT EXISTS "fileData" BYTEA;
