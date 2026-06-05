-- Employee bank account fields (v2.16.1)
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankCode" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankBranch" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankAccountName" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankAccountNo" TEXT;
