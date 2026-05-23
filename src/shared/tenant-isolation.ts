/**
 * Multi-tenant Isolation Guard
 * 確保跨租戶操作時的資料隔離驗證
 */

import { AppError } from './errors.js';

/**
 * 驗證操作的租戶隔離
 * @param requestTenantId - 請求來源的租戶 ID（從 JWT token 提取）
 * @param resourceTenantId - 資源所屬的租戶 ID
 * @throws AppError 如果租戶不匹配
 */
export function assertTenantIsolation(requestTenantId: string, resourceTenantId: string): void {
  if (!requestTenantId) {
    throw new AppError(401, 'UNAUTHORIZED', '請求缺少租戶資訊');
  }

  if (!resourceTenantId) {
    throw new AppError(500, 'INTERNAL_ERROR', '資源缺少租戶資訊');
  }

  if (requestTenantId !== resourceTenantId) {
    throw new AppError(403, 'FORBIDDEN', '無權存取此租戶的資料');
  }
}

/**
 * 驗證批量操作的租戶隔離
 * @param requestTenantId - 請求來源的租戶 ID
 * @param resourceTenantIds - 資源所屬的租戶 ID 陣列
 * @throws AppError 如果任何資源不屬於請求租戶
 */
export function assertTenantIsolationBatch(
  requestTenantId: string,
  resourceTenantIds: string[]
): void {
  if (!requestTenantId) {
    throw new AppError(401, 'UNAUTHORIZED', '請求缺少租戶資訊');
  }

  const invalidResources = resourceTenantIds.filter((id) => id !== requestTenantId);
  if (invalidResources.length > 0) {
    throw new AppError(403, 'FORBIDDEN', `${invalidResources.length} 筆資源不屬於此租戶`);
  }
}

/**
 * 檢查租戶 ID 是否有效（非空、非 null）
 */
export function isValidTenantId(tenantId: unknown): boolean {
  return typeof tenantId === 'string' && tenantId.length > 0;
}

/**
 * 取得安全的租戶篩選條件（用於資料庫查詢）
 */
export function getTenantFilter(tenantId: string) {
  return {
    tenantId,
  };
}
