# Phase 2 -> Phase 3 客戶升級遷移指南

> 經驗來源：2026-06-08 潤樋 ERP 事故 -- DB 從 Supabase 遷移到 Neon 後，Supabase 專案因無活動被自動刪除，Storage bucket 與所有已上傳檔案一併消失且無法復原。

---

## 核心教訓

**DB 遷移 != 平台遷移。** 一個雲平台通常綁定多個服務（DB + Storage + Auth + Edge Functions + Realtime...）。只遷移 DB 而忘記其他服務 = 定時炸彈。

---

## 1. 遷移前必跑的審計清單

每次客戶平台遷移（換 DB provider、換 hosting、合併 instance）前，逐項確認：

| # | 檢查項 | 說明 | 確認方式 |
|---|--------|------|---------|
| 1 | **DB** | 所有 table / view / function / trigger / extension | `pg_dump --schema-only` 比對 |
| 2 | **檔案儲存** | 產品文件(PDS/SDS/DM)、供應商文件、發票附檔、名片圖片 | grep `storage` / `upload` / `bucket` / `SUPABASE` / `S3` |
| 3 | **認證服務** | LINE Login / OAuth / JWT signing key | 確認 JWT_SECRET 是否綁在舊平台 |
| 4 | **排程任務** | cron job / scheduled function（帳款提醒、月結...） | 確認 cron 跑在哪（Fly cron / DB-level / 外部） |
| 5 | **Domain / URL** | 短連結、PDF 下載連結、LIFF redirect URL | grep `PUBLIC_BASE_URL` / `LIFF_URL` |
| 6 | **環境變數** | 舊平台的 secret 是否仍被引用 | diff `.env.template` vs 新平台 secret list |
| 7 | **備份** | 遷移前完整備份（DB dump + 檔案 tarball） | 備份驗證：能從備份還原一個可運行的 instance |

### 自動化檢查腳本（建議加入 CI）

```bash
# 掃描程式碼中對舊平台的殘留引用
grep -rn "SUPABASE\|supabase\|S3_BUCKET\|AWS_ACCESS" src/ --include="*.ts" | grep -v node_modules
grep -rn "createClient\|getSignedUrl\|uploadFile" src/ --include="*.ts" | grep -v node_modules

# 確認 .env.template 的每個 key 都有對應值
while IFS='=' read -r key _; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  echo "CHECK: $key"
done < .env.template
```

---

## 2. 平台服務依賴矩陣

遷移前填寫此表，確認每個服務的去向：

| 服務 | 舊平台 | 新平台 | 遷移方式 | 負責人 | 完成日 |
|------|--------|--------|---------|--------|--------|
| PostgreSQL DB | Supabase | Neon | pg_dump + pg_restore | | |
| 檔案儲存 | Supabase Storage | Neon bytea / Fly Tigris / S3 | 下載 + 重新上傳 | | |
| 認證 | Supabase Auth | 自建 JWT | N/A（已自建） | | |
| Edge Functions | Supabase Functions | Fly app | 重寫為 Express route | | |
| Realtime | Supabase Realtime | N/A | 不使用 | | |

**重點**：表中空白 = 尚未決定 = 風險。所有欄位填完才能開始遷移。

---

## 3. 舊平台停用時序（防止提前刪除）

```
Day 0: 新平台就緒 + 資料遷移完成 + 驗證通過
Day 1-7: 雙寫期（新舊平台同時運行，讀新寫新，舊平台唯讀）
Day 7: 切換 DNS / 環境變數指向新平台
Day 7-30: 觀察期（舊平台保留但不使用，監控是否有殘留引用）
Day 30: 確認無殘留引用後，匯出舊平台所有資料的最終備份
Day 30+: 降級舊平台（free tier / pause），但不刪除
Day 90+: 刪除舊平台帳號（確認 3 個月無任何回頭需求）
```

**Supabase 特別注意**：Free plan 專案在 DB 無活動一段時間後會被 pause，長期 pause 後可能被自動刪除（含 Storage）。暫停期間務必定期 ping 或直接刪除前手動備份 Storage。

---

## 4. 檔案儲存遷移策略比較

| 方案 | 適用場景 | 優點 | 缺點 |
|------|---------|------|------|
| **DB bytea** | 小檔案、低量（<1000 檔 x <10MB） | 零額外服務、備份隨 DB | DB 膨脹、大檔效能差 |
| **Fly Tigris (S3)** | 大量檔案、大檔（影像、CAD...） | S3 相容、CDN、便宜 | 額外服務依賴 |
| **Fly Volume** | 單機、低量 | 簡單、無外部依賴 | 不跨 machine、無自動備份 |
| **R2 / S3** | 已有 AWS/CF 帳號 | 成熟生態系 | 額外帳號管理 |

**建議**：化學品 ERP 的 PDS/SDS/DM 文件量小（每客戶 <100 檔 x <5MB），DB bytea 最簡單。若未來文件量增長（電子發票附檔、照片），再遷到 Tigris。

---

## 5. 多客戶批次升級 SOP

Phase 3 目標是讓多個客戶跑同一套程式碼。升級某客戶時：

### 5.1 升級前

1. **填寫依賴矩陣**（第 2 節）
2. **跑審計清單**（第 1 節）
3. **確認 schema 相容**：`prisma migrate diff` 比對客戶 DB vs 目標版本
4. **備份**：`pg_dump` + 檔案匯出

### 5.2 升級中

1. 維護模式（LINE Bot 回覆「系統升級中」）
2. 跑 DDL（按 `docs/migrations/` 順序）
3. 遷移檔案（若儲存方案改變）
4. 更新環境變數
5. Deploy 新版本
6. 驗證：`/api/version` + `/health` + 關鍵流程冒煙測試

### 5.3 升級後

1. 移除維護模式
2. 通知客戶
3. 監控 error log 24h
4. 更新 control plane 的 `VersionUpgradeLog`

---

## 6. 已知風險與預防

| 風險 | 機率 | 影響 | 預防 |
|------|------|------|------|
| 舊平台自動刪除（Supabase free tier） | 高 | 檔案永久遺失 | 遷移完成後立即備份 Storage；不依賴 free tier 保留 |
| DB schema 版本不一致 | 中 | P2022 / 500 | 先 DDL 再 deploy；mixed-version 相容（鐵則 9） |
| 環境變數殘留指向舊平台 | 中 | 功能靜默失敗 | `fly secrets list` 比對 `.env.template` |
| 短連結 / PDF URL 失效 | 低 | 客戶下載失敗 | JWT 簽名用同一把 `JWT_SECRET`；domain 不變 |
| LINE channel 設定未更新 | 低 | Webhook 收不到 | LIFF URL / Webhook URL 確認指向新 domain |

---

## 7. Checklist 模板（每次遷移複製一份）

```markdown
# 客戶遷移 Checklist: [客戶名] [日期]

## 遷移前
- [ ] 依賴矩陣已填完（所有欄位非空）
- [ ] 程式碼掃描：無舊平台殘留引用
- [ ] DB 備份完成 + 驗證可還原
- [ ] 檔案備份完成（Storage / Volume / 本地）
- [ ] 新平台環境就緒（DB / Storage / Secret）
- [ ] DDL 差異已列出

## 遷移中
- [ ] 維護模式啟用
- [ ] DB 資料遷移完成
- [ ] DDL 執行完成
- [ ] 檔案遷移完成
- [ ] 環境變數更新完成
- [ ] Deploy 成功
- [ ] /api/version 回傳正確版本
- [ ] /health 回傳 OK（含 DB 連線）

## 遷移後
- [ ] LINE Bot 回覆正常
- [ ] 銷貨 / 進貨 / 報價流程冒煙
- [ ] PDF 下載正常
- [ ] 文件下載正常（PDS/SDS/DM）
- [ ] LIFF 表單可開啟 + 送出
- [ ] 後台登入 + 各頁面載入
- [ ] Error log 24h 無異常
- [ ] 舊平台 → 觀察期（不刪除）
- [ ] Control plane VersionUpgradeLog 更新
- [ ] 通知客戶升級完成
```

---

## 附錄：2026-06-08 事故時間線

| 時間 | 事件 |
|------|------|
| 2026-04 | 潤樋 ERP DB 從 Supabase 遷移到 Neon PostgreSQL |
| 2026-04~06 | Supabase 專案因 DB 無活動，Storage 仍有檔案但專案被自動刪除 |
| 2026-06-08 | 使用者報告 PDS 下載失敗（"Storage signed URL failed: fetch failed"） |
| 2026-06-08 | 確認 Supabase 專案已刪除、Storage 檔案無法復原 |
| 2026-06-08 | v2.16.1 修復：改用 Neon PostgreSQL bytea 儲存檔案，零外部依賴 |

**結論**：遷移不是只搬 DB。每次平台異動都要當成「搬家」— 不只搬桌子，還要搬冰箱裡的食物。
