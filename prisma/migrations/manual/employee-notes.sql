-- Employee notes field (v2.17.0)
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "notes" TEXT;
