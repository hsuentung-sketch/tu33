# Handoff: tu33 Topbar 改版 + 品牌 token
**日期**：2026-06-09  
**執行環境**：ERP Claude Code session（D:\Claude\ERP）

---

## 背景

本機檔案已全部更新完畢，但 tu33 跑在 Fly.io（`erp-line-bot.fly.dev`），需在 ERP session 執行 `fly deploy` 才會上線。

---

## 已改動的檔案（本機已存檔）

| 檔案 | 異動說明 |
|------|---------|
| `public/admin/brand-tokens.css` | **新增** — 從 EPR `_templates/_shared/brand-tokens.css` 複製，品牌 token 來源 |
| `public/admin/styles.css` | 套用 token，sidebar → topbar，RWD 手機版，移除 `#2563eb` |
| `public/admin/index.html` | HTML 結構：`<div class="shell"><aside class="sidebar">` → `<header class="topbar">`，內嵌漢堡 toggle JS |

---

## 驗證（deploy 前在 ERP session 執行）

```bash
cd "D:\Claude\ERP"

# 1. 確認無殘留 Tailwind 藍
grep -n "#2563eb\|#3b82f6\|#1f2937\|#eff6ff" public/admin/styles.css
# 預期：0 筆

# 2. 確認 brand-tokens 存在
ls public/admin/brand-tokens.css

# 3. 確認 @import 在第 2 行
head -3 public/admin/styles.css
```

---

## Deploy

```bash
cd "D:\Claude\ERP"

# 如有 PowerShell deploy 腳本：
.\scripts\fly-deploy.ps1

# 或直接：
fly deploy --build-arg GIT_COMMIT=$(git rev-parse --short HEAD)

# deploy 完成後驗證：
curl https://erp-line-bot.fly.dev/api/version
```

---

## 視覺改變說明

| 項目 | Before | After |
|------|--------|-------|
| 佈局 | 左側 sidebar（220px 固定欄） | 頂部 topbar（水平導覽） |
| 主色 | `#2563eb`（Tailwind blue） | `#4F46E5`（品牌 indigo） |
| Sidebar/Topbar 背景 | `#0f172a` | `#1A1A2E`（brand navy） |
| active nav 標記 | 左邊框線 indigo | 底部 2px indigo underline |
| 字體 | `-apple-system, Segoe UI, Noto Sans TC` | `Inter, Noto Sans TC, -apple-system` |
| 手機版 | sidebar 固定常駐（破版） | 漢堡選單 toggle |
| 用戶資訊 | sidebar footer 靠下 | topbar 右側 inline |

---

## 不影響的部分

- **API / 資料庫**：無異動
- **app.js**：無異動（`#brandSub` / `#meLabel` / `#logoutBtn` / `#versionInfo` / `#nav` 所有 ID 保留）
- **login.html**：無異動（獨立頁面，不用 topbar）
- **LINE Bot / LIFF**：無異動

---

## 若需 rollback

```bash
git diff public/admin/styles.css    # 看改了什麼
git checkout public/admin/styles.css public/admin/index.html
# 並刪除 public/admin/brand-tokens.css
fly deploy
```
