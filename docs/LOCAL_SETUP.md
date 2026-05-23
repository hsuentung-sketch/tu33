# 本機開發環境設定指南

> 目標：新開發者在 15 分鐘內從 clone 到看見可運行的 ERP 系統。

---

## 前置需求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 20 | Runtime（使用 tsx 執行 TypeScript） |
| Docker Desktop | 任意 | 執行 PostgreSQL 16 容器 |
| npm | 隨 Node 安裝 | 套件管理 |

選用：LINE Channel（Bot 功能需要）、OpenAI / Anthropic API key（AI 功能需要）。開發階段都可留空。

---

## 快速啟動（5 步驟）

### 1. 安裝依賴

```powershell
cd D:\Claude\ERP
npm install
```

### 2. 啟動 PostgreSQL

先確認 Docker Desktop 已開啟，然後：

```powershell
docker compose -f docker-compose.dev.yml up -d
```

驗證容器啟動：

```powershell
docker ps
# 應看到 erp-dev-postgres (postgres:16-alpine) 在 port 5433
```

> **注意**：使用 port `5433`（非預設 5432），避免與本機其他 PostgreSQL 衝突。

### 3. 設定環境變數

```powershell
copy .env.demo .env
```

編輯 `.env`，修改 `DATABASE_URL` 為：

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/erp_demo?schema=public"
```

其他變數（LINE、SMTP、AI API key）開發階段可留空。

### 4. 同步 Schema 與初始化資料

```powershell
# 產生 Prisma Client
npx prisma generate

# 將 schema 推送到資料庫（建表）
npx prisma db push

# 初始化 Demo 資料（租戶、員工、客戶、方案、訂閱等）
npx tsx src/scripts/demo-seed.ts
```

### 5. 啟動開發伺服器

```powershell
npx tsx src/index.ts
```

或使用 watch 模式（檔案變更自動重啟）：

```powershell
npm run dev
```

---

## 驗證

啟動後開啟瀏覽器確認以下端點：

| URL | 預期結果 |
|-----|----------|
| http://localhost:3000/api/demo/status | `{"status":"ok"}` |
| http://localhost:3000/saas-admin/ | SaaS 主控台儀表板 |
| http://localhost:3000/api/platform/dashboard | JSON 格式的平台總覽數據 |

SaaS 主控台共 6 個頁面：總覽、租戶管理、計費方案、訂閱管理、發票紀錄、版本管理。

---

## 常用指令

| 指令 | 用途 |
|------|------|
| `npm run dev` | 開發模式（watch + 自動重啟） |
| `npx tsx src/index.ts` | 單次啟動（不 watch） |
| `npx prisma generate` | 重新產生 Prisma Client（schema 異動後必跑） |
| `npx prisma db push` | 同步 schema 到資料庫（開發用，不產生 migration 檔） |
| `npx prisma studio` | 開啟 Prisma GUI 瀏覽資料庫 |
| `npx prisma migrate dev` | 產生 migration 檔（正式流程） |
| `npm run build` | TypeScript 編譯（產出 dist/） |
| `npm test` | 執行 vitest 測試 |

---

## Docker 容器管理

```powershell
# 啟動
docker compose -f docker-compose.dev.yml up -d

# 停止（保留資料）
docker compose -f docker-compose.dev.yml down

# 停止並清除資料（重來）
docker compose -f docker-compose.dev.yml down -v
```

清除資料後需要重新跑 `npx prisma db push` + `npx tsx src/scripts/demo-seed.ts`。

---

## 架構速覽

```
erp-line-bot/
  prisma/
    schema.prisma        # 資料模型定義
    seed.ts              # Prisma seed（基礎資料）
  prisma.config.ts       # Prisma CLI 設定（driver adapter）
  src/
    index.ts             # 進入點
    modules/
      core/
        auth/            # JWT 認證 + 角色權限
        billing/         # 計費、訂閱、發票
        version/         # 版本管理 + 退版機制
        platform/        # SaaS 主控台 API
        demo/            # Demo 重置 API
      sales/             # 銷貨模組
      purchase/          # 進貨模組
      accounting/        # 會計模組
      inventory/         # 庫存模組
    shared/
      prisma.ts          # Prisma Client 單例
      errors.ts          # 統一錯誤類別
      tenant-isolation.ts # 多租戶隔離驗證
    line/                # LINE Bot SDK 整合
  public/
    saas-admin/          # SaaS 主控台前端（靜態 SPA）
  docs/
    adr/                 # 架構決策紀錄
```

---

## 常見問題

### Q: `prisma db push` 報 P1001 連線錯誤

確認 Docker Desktop 已啟動，且容器正在運行：

```powershell
docker ps | findstr erp-dev-postgres
```

若容器未啟動，重新執行 `docker compose -f docker-compose.dev.yml up -d`。

### Q: 版本管理頁面 API 500

Schema 異動後未重新產生 Prisma Client。執行：

```powershell
npx prisma generate
```

然後重啟 server。

### Q: Port 3000 被占用

修改 `.env` 中的 `PORT` 為其他值（如 3001）。

### Q: Port 5433 被占用

編輯 `docker-compose.dev.yml`，修改 ports 映射（如 `5434:5432`），同時更新 `.env` 的 `DATABASE_URL`。

### Q: `npx tsx` 指令找不到

確認已執行 `npm install`，tsx 是專案的 devDependency。
