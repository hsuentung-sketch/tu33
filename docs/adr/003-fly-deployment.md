# ADR-003: Fly.io 部署架構

- **狀態**: 已採納
- **日期**: 2026-05-24
- **決策者**: Platform Team

## 背景

ERP SaaS 平台需要一個可靠的雲端部署環境，支援 PostgreSQL、persistent volume（電子發票資料）、HTTPS、自動健康檢查。目前本機開發已穩定（Docker Compose + PostgreSQL 16），需要定義生產部署流程。

## 決策

使用 Fly.io 作為主要部署平台，單機架構（shared-cpu-1x），搭配 Fly Postgres 和 Volume mount。

### 架構概覽

```
Internet → Fly Edge (TLS) → App VM (nrt)
                               ├── Express 5 (port 3000)
                               ├── /data mount (einvoice_data volume)
                               └── Fly Postgres (internal network)
```

### 關鍵配置

| 項目 | 選擇 | 理由 |
|------|------|------|
| Region | nrt (Tokyo) | 距台灣最近，延遲 ~30ms |
| VM | shared-cpu-1x, 512MB | 初期租戶量小，成本低 (~$3/月) |
| DB | Fly Postgres, shared-cpu-1x | 與 app 同 region、internal network 免費流量 |
| Auto-stop | off | ERP 需常駐處理 cron job（版本升級、帳單續訂、逾期檢查） |
| Health check | GET /health, 30s 間隔 | Fly 自動重啟不健康的機器 |

### Migration 策略

```toml
[deploy]
  release_command = 'npx prisma migrate deploy'
```

Fly 在部署新版本時，先在臨時 VM 執行 release_command。若 migration 失敗，部署中止，舊版本繼續運行。這保證了：

1. Migration 先於 app 啟動
2. 失敗不影響線上服務
3. 不需要額外的 CI/CD pipeline

### Secret 管理

透過 `fly secrets set` 注入環境變數，不進 git。`config/index.ts` 的 `requireInProd()` 在 production 環境下若缺少必要 secret 會 boot throw，避免帶著預設值上線。

必要 secret：DATABASE_URL（attach 自動設）、JWT_SECRET、PUBLIC_BASE_URL。

### 部署流程

```bash
fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD)
```

Dockerfile 多階段建置：builder（npm ci + prisma generate + tsc）→ runner（node:20-slim + 生產 deps）。GIT_COMMIT 寫入環境變數供 /api/version 端點顯示。

## 考慮過的替代方案

### A. Railway

優點：UI 友好、自動偵測 Dockerfile。缺點：沒有 Volume mount（電子發票資料需要 persistent storage）、pricing 較貴、亞洲 region 選擇少。

### B. Render

優點：免費方案可用、支援 persistent disk。缺點：free tier 有 cold start（不適合 cron job 常駐）、亞洲只有 Singapore（比 Tokyo 遠）。已有 render.yaml 但未使用。

### C. AWS ECS / GCP Cloud Run

優點：企業級、可擴展。缺點：初期設定複雜度高、成本高、需要 VPC / ALB / RDS 等元件。待租戶數超過 50 再考慮遷移。

### D. 多機 + 負載均衡

優點：高可用。缺點：Prisma 不支援 read replica 自動分流、Volume mount 綁定單一機器、目前流量不需要。fly.toml 已設 min_machines_running = 1，未來可調高。

## 後果

- 單機架構在機器重啟時有短暫中斷（~15 秒），可接受
- Volume 綁定 region，未來要遷移 region 需要手動搬資料
- Fly Postgres 是非託管方案，需自行監控磁碟空間和備份
- release_command 在獨立 VM 跑 migration，會多消耗約 30 秒部署時間

## 限制與已知風險

- **單點故障**：單機 + 單 DB，無 failover。適合初期 (<50 租戶)，超過後應評估多機方案
- **Volume 容量**：einvoice_data 初始 1GB，需監控使用量，必要時 `fly volumes extend`
- **Postgres 備份**：Fly Postgres 預設不自動備份，需手動 `fly postgres backup create` 或搭配 daily-backup.ts job
- **冷啟動**：auto_stop = off 避免冷啟動，但代價是持續計費
