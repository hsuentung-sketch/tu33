# Cloudflare R2 for 電子發票 XML 傳輸 setup

Fly (ERP) 產出 XML → 寫入 R2 bucket → Linode (Turnkey) rclone 每 5 分鐘拉到 Turnkey inbound 目錄 → Turnkey 上傳 EINV。

## 為什麼選 R2

- 免費 10GB 儲存 + 免費 egress（Fly ↔ R2 傳輸不算流量）
- S3 compatible，ERP 現有 `turnkey-storage.ts` 的 s3 backend 直接用
- 不用開 Linode SSH 對外
- Cloudflare 帳號可能你已有

## 一、Cloudflare R2 建立（你的操作）

### 1.1 開通 R2

1. 登入 https://dash.cloudflare.com
2. 左邊選單 **R2 Object Storage** → **Purchase R2 Plan**（免費方案，只需要提供付款方式作為 safeguard，不會扣款）

### 1.2 建 Bucket

1. R2 頁面 → **Create bucket**
2. Bucket name：`erp-einvoice-turnkey`（可自訂，全球唯一）
3. Location：**Asia-Pacific (APAC)** — 較近 Fly nrt 與 Linode Tokyo
4. Storage class：Standard
5. 建立完成

### 1.3 建 API Token

1. R2 頁面右上 **Manage R2 API Tokens** → **Create API token**
2. Token name：`erp-turnkey-rw`
3. Permissions：**Object Read & Write**
4. Specify bucket：選剛建的 `erp-einvoice-turnkey`
5. TTL：Forever（或設 1 年後再換）
6. Create → **立刻複製並保存**：
   - Access Key ID
   - Secret Access Key
   - Endpoint（形如 `https://<accountid>.r2.cloudflarestorage.com`）

**⚠️ Secret 只顯示一次**，找地方存起來。

## 二、Fly 端設定（設好 secrets 我做）

四個 secrets 要設到 erp-line-bot：

```bash
fly secrets set -a erp-line-bot \
  TURNKEY_S3_ENDPOINT="https://<accountid>.r2.cloudflarestorage.com" \
  TURNKEY_S3_BUCKET="erp-einvoice-turnkey" \
  TURNKEY_S3_ACCESS_KEY="<access-key-id>" \
  TURNKEY_S3_SECRET="<secret-access-key>" \
  TURNKEY_S3_REGION="auto"
```

（設完 Fly 會自動重啟 app）

**潤樋 tenant.settings.einvoice 三個欄位改**：
- `turnkeyBackend`: `"s3"`
- `turnkeyInboundDir`: `"runtong/inbound/"`（bucket 內 prefix，末尾要斜線）
- `turnkeyOutboundDir`: `"runtong/outbound/"`

## 三、Linode 端 rclone 設定（你的操作或我遠端指導）

### 3.1 設 rclone remote

VNC 進 Linode → 開 Terminal：

```bash
rclone config
```

互動式問答：
- n) New remote
- name → `r2`
- Storage → 選 `s3` (Amazon S3 Compliant Storage Providers)
- provider → `Cloudflare` (或 Other)
- env_auth → false
- access_key_id → 貼你的 R2 Access Key ID
- secret_access_key → 貼你的 R2 Secret
- region → `auto`
- endpoint → 貼你的 R2 endpoint URL
- location_constraint → 空
- acl → private
- 其他預設
- q) Quit

### 3.2 測試 rclone 能通

```bash
rclone lsd r2:erp-einvoice-turnkey
```

看得到 bucket 內容（空的 OK）就 pass。

### 3.3 加拉 XML 的 cron job

編輯 crontab：

```bash
crontab -e
```

加這行（每 5 分鐘拉 inbound 到 Turnkey 上傳目錄）：

```cron
*/5 * * * * rclone move r2:erp-einvoice-turnkey/runtong/inbound /opt/turnkey/app/linux/EINVTurnkey/UpCast/B2SSTORAGE --min-age 10s >> /var/log/rclone-einvoice-inbound.log 2>&1
```

**注意**：
- `move` 不是 `copy` — 拉完就從 R2 刪，避免重複處理
- `--min-age 10s` — 只拉 10 秒前寫入的檔，避免抓到寫一半的
- log 存 `/var/log/rclone-einvoice-inbound.log` 除錯用

### 3.4（選配）Turnkey outbound 推回 R2 給 ERP 讀

```cron
*/5 * * * * rclone move /opt/turnkey/app/linux/EINVTurnkey/DownCast/B2SSTORAGE r2:erp-einvoice-turnkey/runtong/outbound --min-age 10s >> /var/log/rclone-einvoice-outbound.log 2>&1
```

ERP `einvoice-sync.ts` 03:30 cron 從 R2 拉 outbound → 更新 einvoice status。

## 四、E2E 測試流程

1. Task A 完成（有字軌）
2. Task B1 完成（R2 建好、Fly secrets 設好、Linode rclone 跑起來、tenant.settings 改成 s3）
3. 從潤樋後台開一張測試發票
4. **驗證鏈**：
   - Fly log 顯示 `einvoice: wrote XML backend=s3`
   - R2 bucket `runtong/inbound/` 有 XML
   - 5 分鐘內 rclone 拉走
   - Linode `/opt/turnkey/app/linux/EINVTurnkey/UpCast/B2SSTORAGE/` 有 XML
   - Turnkey 15 分鐘內上傳（排程紀錄 UpCast → Pack → SendFile → connectSftp）
   - Turnkey 排程紀錄 `receiveFileDone` 拿到 EINV 回覆
   - Linode `DownCast/B2SSTORAGE/` 有 process result
   - 5 分鐘內 rclone 推到 R2 outbound
   - 隔天 03:30 ERP einvoice-sync 拉 outbound → 更新 status=confirmed
5. 登入 EINV 測試平台查該筆發票確實存在

## 疑難排解

| 問題 | 解法 |
|---|---|
| Fly 寫 R2 失敗 401 | Access key / secret 打錯 |
| rclone 拉不到檔 | 檢查 endpoint URL 開頭是 https 且結尾沒斜線 |
| XML 拉到 Turnkey 但沒上傳 | 檔案權限；Turnkey 只讀 owner 讀寫檔案 → `chmod 664` |
| 拉到 XML 檔名太怪 Turnkey 忽略 | 改 rclone 加 `--include "F0401_*.xml"` |
