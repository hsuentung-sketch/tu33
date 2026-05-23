-- P0-2 lineUserId composite unique 隔離修正
-- Employee 和 Customer lineUserId 改為 (tenantId, lineUserId) 的 composite unique

-- Employee: 移除全局 lineUserId unique，加上 composite unique
DROP INDEX IF EXISTS "Employee_lineUserId_key";
CREATE UNIQUE INDEX "Employee_tenantId_lineUserId_key"
  ON "Employee"("tenantId", "lineUserId");

-- Customer: 新增 composite unique（之前無 unique 約束）
CREATE UNIQUE INDEX "Customer_tenantId_lineUserId_key"
  ON "Customer"("tenantId", "lineUserId");
