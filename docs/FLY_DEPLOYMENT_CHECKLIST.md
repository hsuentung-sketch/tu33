# Fly.io 部署檢查清單

**適用版本**: v2.15.0+
**目標平台**: Fly.io (Tokyo nrt region)
**架構**: Express 5 + Prisma 7 + PostgreSQL 16

---

## A. 首次部署（新租戶 / 新環境）

### A1. 前置準備

- [ ] 安裝 Fly CLI: `curl -L https://fly.io/install.sh | sh`
- [ ] 登入: `fly auth login`
- [ ] 確認 fly.toml 的 `app` 名稱正確

### A2. 建立 Fly App

```bash
fly apps create <app-name>
```

### A3. 建立 Fly Postgres

```bash
fly postgres create --name <app-name>-db --region nrt --vm-size shared-cpu-1x
fly postgres attach <app-name>-db -a <app-name>
```

attach 會自動設定 DATABASE_URL secret。

### A4. 建立 Volume（電子發票資料）

```bash
fly volumes create einvoice_data --region nrt --size 1 -a <app-name>
```

### A5. 設定 Secrets

必填：

```bash
# JWT — 產生安全隨機值
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" -a <app-name>

# 對外 URL
fly secrets set PUBLIC_BASE_URL="https://<app-name>.fly.dev" -a <app-name>
```

選配（依功能需求）：

```bash
# LINE Bot
fly secrets set LINE_CHANNEL_ID=... LINE_CHANNEL_SECRET=... LINE_CHANNEL_ACCESS_TOKEN=... -a <app-name>

# Email
fly secrets set SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_FROM=... -a <app-name>

# AI
fly secrets set OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GOOGLE_VISION_API_KEY=... -a <app-name>

# Supabase Storage
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... -a <app-name>
```

### A6. 首次部署

```bash
fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD) -a <app-name>
```

`[deploy] release_command` 會自動執行 `npx prisma migrate deploy`。

### A7. 初始化 Demo 資料（僅 demo 環境）

```bash
fly secrets set NODE_ENV=demo -a <app-name>
fly deploy -a <app-name>
curl -X POST https://<app-name>.fly.dev/api/demo/reset
```

### A8. 驗證

```bash
curl https://<app-name>.fly.dev/health
curl https://<app-name>.fly.dev/api/demo/status  # demo 環境
fly logs -a <app-name> --since 5m
```

---

## B. 日常部署

### B1. 部署前

- [ ] `npm run build` 編譯成功
- [ ] `npm test` 測試通過
- [ ] git 已 commit & push
- [ ] 若有 schema 變更，已建立 migration: `npm run db:migrate`

### B2. 部署

```bash
fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD)
```

### B3. 部署後

- [ ] `fly logs --since 2m` 無異常
- [ ] `curl https://<app-name>.fly.dev/health` 回 200
- [ ] 主控台可正常載入: `https://<app-name>.fly.dev/saas-admin/`

---

## C. Rollback

### C1. 應用層退版

```bash
# 列出部署歷史
fly releases -a <app-name>

# 退回上一版
fly releases rollback -a <app-name>
```

### C2. 資料庫 Rollback

Prisma migrate 不支援自動 rollback。若需退版：

1. 確認要退到哪個 migration
2. 手動執行反向 SQL
3. 更新 _prisma_migrations 表

建議：重大 schema 變更前先備份。

### C3. 備份與還原

```bash
# 備份
fly postgres backup create -a <app-name>-db

# 列出備份
fly postgres backups list -a <app-name>-db
```

---

## D. 監控

### D1. 日誌

```bash
fly logs -a <app-name>              # 即時日誌
fly logs -a <app-name> --since 1h   # 最近 1 小時
fly logs -a <app-name> | grep ERROR  # 篩選錯誤
```

### D2. 機器狀態

```bash
fly status -a <app-name>
fly machine list -a <app-name>
```

### D3. 健康檢查

fly.toml 已設定 `GET /health` 每 30 秒檢查。失敗時 Fly 會自動重啟機器。

### D4. PostgreSQL 監控

```bash
fly postgres connect -a <app-name>-db
# 在 psql 內：
# SELECT pg_database_size('postgres');
# SELECT count(*) FROM _prisma_migrations;
```

---

## E. 成本參考

| 資源 | 規格 | 預估月費 |
|------|------|----------|
| App VM | shared-cpu-1x, 512MB | ~$3.19 |
| Postgres | shared-cpu-1x, 256MB, 1GB disk | ~$1.94 |
| Volume | 1GB (einvoice_data) | ~$0.15 |
| **合計** | | **~$5.28** |

注意：Fly 免費額度可能覆蓋部分費用，實際帳單依使用量而定。

---

## F. 常見問題

### deploy 卡在 release_command

release_command (`prisma migrate deploy`) 跑在臨時 VM，若 DB 連不上會失敗。檢查：
- Postgres app 是否 running: `fly status -a <app-name>-db`
- DATABASE_URL secret 是否正確: `fly secrets list -a <app-name>`

### 502 Bad Gateway

通常是 app 還在啟動。grace_period 設 15 秒，等一下再試。若持續：
- `fly logs` 看 boot 錯誤
- 最常見：缺 secret（JWT_SECRET / DATABASE_URL）→ config/index.ts 的 requireInProd 會 throw

### Volume mount 找不到 /data

首次部署需先建立 volume（步驟 A4）。Volume 與 region 綁定，確認 volume region = app primary_region。
