# P0-3a 版本管理實現總結

## 概述
實現完整的 SaaS 版本管理系統，支持自動升級和 30 天寬限期設計。

## 實現步驟

### Step 1: 數據模型 ✅
**檔案**: `prisma/schema.prisma` + `prisma/migrations/manual/20260521_version_management.sql`

#### VersionHistory
- `id`: 版本記錄 ID（CUID）
- `version`: 版本號（X.Y.Z 格式，唯一）
- `releaseDate`: 發布日期
- `supportedUntil`: 寬限期截止日期（= now + 30 days）
- `features`: 功能列表（TEXT 陣列）
- `notes`: 發版說明
- `isActive`: 是否活躍
- 索引: `releaseDate`, `supportedUntil`

#### TenantVersionSubscription
- `id`: 訂閱記錄 ID
- `tenantId`: 租戶 ID（FK → Tenant, CASCADE）
- `currentVersion`: 當前版本
- `latestVersion`: 最新可用版本
- `upgradeDeadline`: 升級截止日期（寬限期）
- `lastCheckedAt`: 上次檢查時間
- `lastUpgradedAt`: 上次升級時間
- 索引: `tenantId` (unique), `upgradeDeadline`

### Step 2: 服務層 ✅
**檔案**: `src/modules/core/version/version.service.ts`

#### 核心函數

1. **publishVersion(input: { version, features, notes })**
   - 創建 VersionHistory 記錄，supportedUntil = now + 30 days
   - 為所有活躍租戶更新 TenantVersionSubscription
   - 發送 LINE 推播通知

2. **getLatestVersion()**
   - 返回最新活躍版本

3. **getTenantUpdates(tenantId)**
   - 返回租戶當前版本、最新版本、升級截止日期
   - 計算距離截止日期的天數
   - 返回是否可升級

4. **upgradeVersion(tenantId, targetVersion)**
   - 驗證目標版本存在且活躍
   - 更新租戶的 currentVersion
   - 清除 upgradeDeadline（已完成升級）
   - 發送升級完成通知

5. **autoUpgradeExpiredVersions()**
   - Cron job handler
   - 查找 upgradeDeadline < now 的租戶
   - 自動升級到 latestVersion
   - 返回升級結果統計

6. **notifyVersionAvailable(tenantId, version)** [私有]
   - 發送 LINE 推播通知
   - 通知所有活躍員工

7. **notifyVersionUpgradeCompleted(tenantId, version)** [私有]
   - 發送升級完成通知
   - 通知所有活躍員工

### Step 3: API 路由 ✅
**檔案**: `src/modules/core/version/version.router.ts`

#### 路由映射

| 方法 | 路由 | 權限 | 描述 |
|------|------|------|------|
| POST | /api/versions | ADMIN | 發布新版本 |
| GET | /api/versions | ADMIN | 查詢所有版本（支持 includeInactive 參數） |
| GET | /api/versions/tenant/updates | 任何人 | 查詢租戶的版本更新狀態 |
| POST | /api/versions/tenant/upgrade | 任何人 | 租戶手動升級版本 |
| POST | /api/versions/auto-upgrade | ADMIN | 手動觸發自動升級（測試用） |

#### 請求/響應示例

**POST /api/versions - 發布新版本**
```json
{
  "version": "2.0.0",
  "features": ["新功能 A", "新功能 B"],
  "notes": "重要安全更新"
}
```

**GET /api/versions/tenant/updates - 查詢更新狀態**
```json
{
  "currentVersion": "1.5.0",
  "latestVersion": "2.0.0",
  "upgradeDeadline": "2026-06-20T10:00:00Z",
  "daysUntilDeadline": 30,
  "canUpgrade": true,
  "latestVersionDetails": { ... }
}
```

**POST /api/versions/tenant/upgrade - 租戶升級**
```json
{
  "targetVersion": "2.0.0"
}
```

### Step 4: Cron Job ✅
**檔案**: `src/jobs/daily-version-auto-upgrade.ts`

- **排程**: 每天 10:00 AM (Asia/Taipei)
- **流程**:
  1. 查找所有 upgradeDeadline < now 且未升級的租戶
  2. 自動升級到 latestVersion
  3. 發送 LINE 升級完成通知
  4. 記錄升級結果

- **集成**: `src/index.ts` 中在 `app.listen` 時調用 `scheduleDailyVersionAutoUpgrade()`

### Step 5: 應用集成 ✅

**routes/index.ts**
```typescript
import { versionRouter } from '../modules/core/version/version.router.js';
// ...
apiRouter.use('/versions', versionRouter);
```

**index.ts**
```typescript
import { scheduleDailyVersionAutoUpgrade } from './jobs/daily-version-auto-upgrade.js';
// ...
app.listen(config.port, '0.0.0.0', () => {
  // ...
  scheduleDailyVersionAutoUpgrade();
  // ...
});
```

### Step 6: 測試 ✅
**檔案**: `src/modules/core/version/version.test.ts`

測試覆蓋：
- ✅ 發布新版本（驗證 30 天寬限期）
- ✅ 版本重複檢查
- ✅ 租戶查詢可用更新
- ✅ 計算截止日期倒數
- ✅ 租戶手動升級
- ✅ 升級無效版本处理
- ✅ 自動升級過期版本
- ✅ 跳過未過期版本
- ✅ 多租戶隔離驗證

## 業務流程

### 版本發布流程
```
Admin 發布新版本 (v2.0.0)
    ↓
創建 VersionHistory
  - version: "2.0.0"
  - supportedUntil: now + 30 days
  - isActive: true
    ↓
為所有活躍租戶更新 TenantVersionSubscription
  - latestVersion: "2.0.0"
  - upgradeDeadline: now + 30 days
    ↓
發送 LINE 推播通知給所有租戶員工
  - 新版本可用
  - 功能說明
  - 寬限期截止時間
```

### 租戶升級流程
```
方案 A：主動升級
  租戶選擇升級 → 調用 POST /api/versions/tenant/upgrade
    ↓
  驗證目標版本有效 → 更新 currentVersion → 清除 upgradeDeadline
    ↓
  發送升級完成通知

方案 B：自動升級（30 天後）
  Cron Job（每天 10:00 AM 執行）
    ↓
  查找 upgradeDeadline < now 的租戶
    ↓
  自動升級到 latestVersion
    ↓
  發送升級完成通知
```

## 多租戶隔離

✅ **隔離確保**:
1. VersionHistory 全域（所有租戶共享版本信息）
2. TenantVersionSubscription 按 tenantId 隔離
3. 所有查詢都使用 `tenantId` 篩選
4. 升級操作僅影響指定租戶
5. LINE 通知僅發送給該租戶的員工

## 技術細節

### 寬限期設計
- **支持期**: 30 天（`supportedUntil = now + 30 days`）
- **升級截止期**: 設置在 `TenantVersionSubscription.upgradeDeadline`
- **時區**: 使用業務時區（Asia/Taipei）
- **緩衝期**: 給租戶充足時間完成升級

### 通知機制
- **通知方式**: LINE 推播（一對一 push message）
- **接收者**: 租戶的所有活躍員工（`lineUserId NOT NULL`）
- **內容**:
  - 版本可用通知：版本號、新功能、寬限期
  - 升級完成通知：版本號、完成狀態

### 錯誤處理
- 通知失敗不阻斷主流程（try-catch 記錄日誌）
- 升級失敗會在 autoUpgradeExpiredVersions 結果中反映
- 無效版本、inactive 版本均有驗證

## 未來擴展點

1. **租戶可選升級**：允許租戶在寬限期內選擇延遲升級
2. **分組升級**：按租戶等級（trial/standard/premium）分批升級
3. **升級計畫排期**：admin 可預排升級時間窗口
4. **版本回滾**：允許 admin 暫停某版本、降級租戶
5. **升級統計儀表板**：admin 可查看升級進度、失敗原因
6. **升級前檢查**：自動化兼容性檢查、資料庫遷移驗證

## 文件清單

```
新建文件：
- src/modules/core/version/version.service.ts
- src/modules/core/version/version.router.ts
- src/modules/core/version/version.test.ts
- src/jobs/daily-version-auto-upgrade.ts

修改文件：
- prisma/schema.prisma (新增 VersionHistory, TenantVersionSubscription, Tenant.versionSubscription)
- prisma/migrations/manual/20260521_version_management.sql (新增)
- src/routes/index.ts (導入 versionRouter，註冊路由)
- src/index.ts (導入、調用 scheduleDailyVersionAutoUpgrade)

遷移文件：
- prisma/migrations/manual/20260521_version_management.sql
- prisma/migrations/manual/20260521_lineUserId_composite_unique.sql (前期)
```

## 驗收檢查清單

- [x] 數據模型完整（VersionHistory, TenantVersionSubscription）
- [x] 服務層實現（7 個核心函數）
- [x] API 路由設計（5 個端點）
- [x] Cron job 排程（每日 10:00 AM）
- [x] 應用集成（routes/index.ts, index.ts）
- [x] 多租戶隔離驗證
- [x] 測試覆蓋（6 大場景）
- [x] 錯誤處理（驗證、通知失敗）
- [x] LINE 通知整合
- [x] 文件文檔
