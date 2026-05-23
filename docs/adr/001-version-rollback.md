# ADR-001: 版本退版機制 (Version Rollback)

- **狀態**: 已採納
- **日期**: 2026-05-22
- **決策者**: Platform Team

## 背景

SaaS ERP 平台的版本管理原本只支援單向升級：發布新版 → 通知租戶 → 30 天寬限期後自動升級。若租戶升級後遇到問題（功能不相容、workflow 中斷），沒有機制可以退回上一版本。

## 決策

新增版本退版機制，允許租戶在升級後退回上一版本，並建立完整的版本變更歷程記錄。

### Schema 異動

1. **`TenantVersionSubscription.previousVersion`** (String, nullable)
   - 升級時自動存入舊版本號
   - Rollback 後清為 null（防止連續退版）

2. **`VersionUpgradeLog`** (新 model)
   - 記錄每次版本變更：tenantId, fromVersion, toVersion, changeType, operatorId, reason
   - `changeType` enum: `UPGRADE` | `ROLLBACK` | `AUTO_UPGRADE`

3. **`BillingSubscriptionLog`** (新 model)
   - 記錄方案變更歷程：action, fromPlan, toPlan, operator, reason, metadata
   - 與版本 log 分離，因為計費和版本是獨立生命週期

### 退版規則

| 規則 | 說明 |
|---|---|
| 只能退一步 | 只保留 previousVersion，不支援退回更早版本 |
| 連續退版禁止 | rollback 後 previousVersion 設為 null |
| 舊版本必須仍為 active | 若舊版本已被停用（isActive=false），不允許退回 |
| 退版寫 log | changeType = ROLLBACK，含 operatorId 和 reason |
| 自動升級也寫 log | changeType = AUTO_UPGRADE |

### API

| Endpoint | 說明 |
|---|---|
| `POST /api/tenant/rollback` | 租戶手動退版，body: `{ reason?: string }` |
| `GET /api/platform/versions` | 平台端查詢，新增 `upgradeLogs` 欄位 |

## 考慮過的替代方案

### A. 多版本歷程表（保留所有歷史版本）

優點：可退回任意版本。缺點：複雜度高，需要驗證每個版本的 DB migration 相容性。目前 SaaS 的版本號是邏輯標記（控制功能開關），不涉及 DB schema 差異，因此退一步已足夠。

### B. 不做退版，只做「暫停升級」

優點：簡單。缺點：無法解決「升級後發現問題」的場景。

## 後果

- 升級流程多一步 $transaction（寫 subscription + log），效能影響可忽略
- 前端需配合：主控台版本頁需顯示升級歷程表、租戶端需加退版按鈕
- 未來若版本號與 DB migration 綁定，退版機制需擴充為含 migration rollback

## 限制與已知風險

- **不處理 DB schema rollback**：目前版本號是功能旗標，不控制 DB 結構。若未來版本升級包含 migration，退版機制需配合 migration down script
- **只退一步**：如需退回更早版本，需由平台管理員手動介入
