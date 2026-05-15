# 電子發票 XML 同步部署指南

> Fly.io 容器無持久 FS（重啟丟失）。Turnkey 整合服務跑在公司主機。中間需要一條「Fly → 公司主機」的搬運通道。本文件說明 v2.11.0 起支援的兩種 backend。

## 兩種 backend 比較

| 維度 | `local` | `s3` |
|---|---|---|
| 適用情境 | 開發 / 公司內單機部署 | 雲端部署（Fly / k8s）+ 公司主機分離 |
| Fly 容器需求 | 持久 volume（昂貴、區域綁定） | 無 |
| 公司主機需求 | NFS / SMB share 給 Fly | 跑 rclone / 任何 S3 client 拉檔 |
| Outbound 防火牆 | 開 inbound port 給 Fly | 公司主機 outbound 連 S3 即可（HTTPS） |
| 加密 | 自管 | 走 HTTPS + bucket 加密 |
| 推薦度 | dev | **production** |

## `local` backend（預設）

設定 `tenant.settings.einvoice.turnkeyBackend = 'local'`（或不設，預設）。

- `turnkeyInboundDir`：絕對路徑，Fly 寫 XML 到這裡
- `turnkeyOutboundDir`：絕對路徑，Fly 讀 Turnkey 回執

⚠️ Fly 上 production 不要用 local：容器重啟 FS 清空。

## `s3` backend（推薦）

### Step 1：開 S3-compatible bucket

選一家：

| 服務 | 免費 tier | 適合性 |
|---|---|---|
| **Cloudflare R2** | 10 GB / 月 / 帳號，**免出口費** | ★ 推薦（出口費為零是關鍵） |
| **Fly Tigris**（`fly storage create`） | 5 GB / 月 | 與 Fly 同 region，延遲低 |
| AWS S3 | 5 GB / 月（12 個月） | 出口費貴 |
| MinIO（自架） | 自管 | 需要自己有 server |

開好後拿到：
- Endpoint（如 `https://<account-id>.r2.cloudflarestorage.com`）
- Region（R2 / Tigris 用 `auto`）
- Bucket name（如 `erp-einvoice`）
- Access Key ID
- Secret Access Key

### Step 2：設 Fly secrets

```bash
fly secrets set \
  TURNKEY_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
  TURNKEY_S3_REGION=auto \
  TURNKEY_S3_BUCKET=erp-einvoice \
  TURNKEY_S3_ACCESS_KEY=xxxxxxxxxxxxxxxx \
  TURNKEY_S3_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Step 3：設 tenant settings

在後台「系統設定」（或直接改 DB `tenant.settings`）：

```json
{
  "einvoice": {
    "enabled": true,
    "turnkeyBackend": "s3",
    "turnkeyInboundDir": "tenant-runtong/inbound/",
    "turnkeyOutboundDir": "tenant-runtong/outbound/",
    ...
  }
}
```

**per-tenant prefix 是隔離點** — 同一個 bucket 給多家公司用，各自的 prefix 互不干擾。

### Step 4：公司主機端 rclone 設定

公司主機（跑 Turnkey 的那台 Windows / Linux）：

#### 4a. 安裝 rclone

Windows：[下載 rclone.exe](https://rclone.org/downloads/)，放 `C:\rclone\`，加到 PATH。
Linux：`curl https://rclone.org/install.sh | sudo bash`

#### 4b. 設定 remote

```bash
rclone config
# n) New remote
# name> erp-r2
# Storage> s3
# provider> Cloudflare R2  (或 Other for Tigris)
# access_key_id> <同上>
# secret_access_key> <同上>
# region> auto
# endpoint> https://<account-id>.r2.cloudflarestorage.com
```

驗證：
```bash
rclone ls erp-r2:erp-einvoice/tenant-runtong/inbound/
```

#### 4c. 排程拉檔 → Turnkey inbound 目錄

Windows 工作排程器，每 5 分鐘：

```cmd
rclone move erp-r2:erp-einvoice/tenant-runtong/inbound/ C:\Turnkey\inbound\ ^
  --include "*.xml" ^
  --log-file C:\rclone\pull-einvoice.log ^
  --log-level INFO
```

Linux cron（`/etc/cron.d/einvoice-pull`）：

```cron
*/5 * * * * turnkeyuser rclone move erp-r2:erp-einvoice/tenant-runtong/inbound/ /opt/turnkey/inbound/ --include "*.xml" --log-file /var/log/einvoice-pull.log
```

`move` 而非 `copy` — 拉下來後 S3 那邊就刪掉，避免下次重抓。

#### 4d. 排程把回執上傳到 outbound

Turnkey 處理完會在 outbound 目錄產生 `<invoiceNo>_CONFIRMED.xml` 或 `<invoiceNo>_REJECTED.xml`。每 5 分鐘推回 S3：

Windows：
```cmd
rclone move C:\Turnkey\outbound\ erp-r2:erp-einvoice/tenant-runtong/outbound/ ^
  --include "*.xml" ^
  --log-file C:\rclone\push-einvoice.log
```

Linux：
```cron
*/5 * * * * turnkeyuser rclone move /opt/turnkey/outbound/ erp-r2:erp-einvoice/tenant-runtong/outbound/ --include "*.xml" --log-file /var/log/einvoice-push.log
```

Fly 側 `einvoice-sync` cron 每天 02:30 跑（`src/jobs/einvoice-sync.ts`），會掃 outbound prefix → 更新 DB status，並把處理過的檔加 `.processed-<ts>` 後綴。

## 驗證

```bash
# Fly 端：開一張測試發票 → 看 log
fly logs | grep 'einvoice: wrote XML'
# 應該看到 backend=s3 與 locator=tenant-xxx/inbound/C0401_AB12345678_<ts>.xml

# S3 端：list 看 XML 是否在
rclone ls erp-r2:erp-einvoice/tenant-runtong/inbound/

# 公司主機端：等 5 分鐘 → 看 Turnkey inbound 目錄
ls C:\Turnkey\inbound\ | findstr C0401
```

## 故障排除

| 症狀 | 可能原因 |
|---|---|
| Fly 寫 XML 拋 `S3 backend 未設定齊全` | 4 個 `TURNKEY_S3_*` 環境變數有任一個沒設 |
| Fly 寫 XML 拋 `S3 PUT 失敗 403` | accessKey / secret 錯，或 bucket 政策不允許 PUT |
| Fly 寫 XML 拋 `S3 PUT 失敗 404` | bucket 名稱錯，或 endpoint 不對 |
| 公司端 rclone `--dry-run` 看不到檔 | prefix 路徑寫錯（注意尾 `/`），或 Fly 還沒寫進去 |
| Outbound 抓不回 | 回執 prefix 設錯；或公司端 push cron 沒跑 |

## 安全注意

- Access key 走 `process.env`，**不**進 DB / log（避免 audit log 洩漏）
- per-tenant 用 prefix 隔離，但 bucket-level 還是同一把 key — 若需更嚴隔離，改為 per-tenant bucket + 不同 IAM key
- bucket 應**關閉 public read**（不能讓外人列檔）
- 公司主機 rclone config 加密密碼（`rclone config password`）
