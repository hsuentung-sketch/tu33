/**
 * Multi-tenant Isolation Guard
 *
 * 確保跨租戶操作時的資料隔離驗證。比對「請求來源 tenantId」與「已 fetch 的資源 tenantId」。
 *
 * ⚠️ **這個 helper 只用於「已從 DB fetch row 後」的二次比對**。
 *
 * 不要在 service.list / service.findFirst / service.create 等「查詢前」階段呼叫；
 * 那時候根本沒有 resourceTenantId 可比對。查詢前的隔離靠 prisma `where: { tenantId }`
 * 自然就會過濾，不需要這個 helper。
 *
 * ✓ 正確用法（已 fetch row → 二次比對防偽造 ID 攻擊）：
 *     const log = await prisma.visitLog.findUnique({ where: { id } });
 *     if (!log) throw new NotFoundError('VisitLog', id);
 *     assertTenantIsolation({ requestTenantId: req.tenantId, resourceTenantId: log.tenantId });
 *
 * ✓ 更精簡（等價、推薦）：直接在 prisma where 帶 tenantId 一併過濾：
 *     const log = await prisma.visitLog.findFirst({ where: { id, tenantId: req.tenantId } });
 *     if (!log) throw new NotFoundError('VisitLog', id);
 *
 * ✗ 錯誤（2026-06-01 全 ERP 47 處踩到的雷）：
 *     export async function list(tenantId, filter) {
 *       assertTenantIsolation({ requestTenantId: tenantId, resourceTenantId: 'sales' }); // ← 'sales' 不是 tenantId！
 *       return prisma.visitLog.findMany({ where: { tenantId, ...filter } });
 *     }
 *
 * 防呆設計：簽名改用 object 參數（named arg），讓使用者不會把模組名字串塞錯位置 ——
 * 字面字串 'sales' 仍可塞進 `resourceTenantId` 欄位（型別都是 string），但寫起來更明顯
 * 意圖錯誤、code review 也更容易抓到。
 */

import { AppError } from './errors.js';

export interface TenantIsolationCheck {
  /** 從 request auth context 拿的 tenantId（req.tenantId）。 */
  requestTenantId: string;
  /** 從 DB fetched row 拿的 tenantId（如 `row.tenantId`），絕對不是模組名/字面值。 */
  resourceTenantId: string;
}

/**
 * 驗證 fetched resource 與 request 屬同一租戶。
 *
 * @throws AppError(401) requestTenantId 為空（auth context 缺）
 * @throws AppError(500) resourceTenantId 為空（資源資料異常）
 * @throws AppError(403) tenantId 不匹配（跨租戶存取嘗試）
 */
export function assertTenantIsolation({ requestTenantId, resourceTenantId }: TenantIsolationCheck): void {
  if (!requestTenantId) {
    throw new AppError(401, '請求缺少租戶資訊', 'UNAUTHORIZED');
  }

  if (!resourceTenantId) {
    throw new AppError(500, '資源缺少租戶資訊', 'INTERNAL_ERROR');
  }

  if (requestTenantId !== resourceTenantId) {
    throw new AppError(403, '無權存取此租戶的資料', 'FORBIDDEN');
  }
}

export interface TenantIsolationBatchCheck {
  requestTenantId: string;
  /** 從多筆 DB fetched rows 抽出的 tenantId 陣列。 */
  resourceTenantIds: string[];
}

/**
 * 批量驗證多筆 fetched resources 是否都屬於同一請求租戶。
 *
 * 同樣只用於「已從 DB fetch」之後，不要在 list 查詢前呼叫。
 *
 * @throws AppError(401) requestTenantId 為空
 * @throws AppError(403) 任何一筆 resource 不屬於 requestTenantId
 */
export function assertTenantIsolationBatch({ requestTenantId, resourceTenantIds }: TenantIsolationBatchCheck): void {
  if (!requestTenantId) {
    throw new AppError(401, '請求缺少租戶資訊', 'UNAUTHORIZED');
  }

  const invalidResources = resourceTenantIds.filter((id) => id !== requestTenantId);
  if (invalidResources.length > 0) {
    throw new AppError(403, `${invalidResources.length} 筆資源不屬於此租戶`, 'FORBIDDEN');
  }
}

/**
 * 檢查租戶 ID 是否有效（非空、非 null）。
 */
export function isValidTenantId(tenantId: unknown): boolean {
  return typeof tenantId === 'string' && tenantId.length > 0;
}

/**
 * 取得安全的租戶篩選條件（用於資料庫查詢）。
 *
 * 推薦：list/findMany/findFirst 階段用這個方法（或直接展開到 where），
 * 不要呼叫 assertTenantIsolation —— 那是給「已 fetch row 後」的二次防禦。
 */
export function getTenantFilter(tenantId: string) {
  return {
    tenantId,
  };
}
