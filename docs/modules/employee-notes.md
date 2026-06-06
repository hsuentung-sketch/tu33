# 員工備忘欄位（employee-notes）

> Employee model 新增 `notes` 備忘欄位，管理員後台可編輯，LINE Bot 查詢時顯示。

## Trigger

- **後台編輯**：ADMIN 在後台「員工」頁開啟編輯 modal，填寫或修改 notes 欄位後儲存。
- **LINE Bot 查詢**：任何員工在 LINE chat 輸入「員工清單」或相關管理指令時，回覆內容附帶 notes（若有值）。

## Scope

### 1. Schema 異動

- `prisma/schema.prisma`：Employee model 新增 `notes String?`，放在 `address` 之後。
- Nullable，無長度限制（PostgreSQL `TEXT`）。不需 migration script（用 `prisma db push` 或 Supabase SQL Editor `ALTER TABLE "Employee" ADD COLUMN "notes" TEXT`）。
- 滾動部署安全：新欄位 nullable，舊 code 不讀不寫不會壞。

### 2. Service 層（employee.service.ts）

- `create()`：data 型別加 `notes?: string`，傳入 prisma create。
- `update()`：data 型別加 `notes?: string`，傳入 prisma update。
- `findMany()` / `findById()`：select 已含全欄位（Prisma 預設），無需改。

### 3. Router 層（employee.router.ts）

- POST `/api/employees`：body 接受 `notes`。
- PUT `/api/employees/:id`：body 接受 `notes`。
- GET 回傳已自動包含 `notes`。
- 驗證：`notes` 為 optional string，若傳入則 trim；空字串存為 `null`。

### 4. 後台前端（public/admin/app.js）

- `viewEmployees` 列表：不顯示 notes 欄（列表已滿），hover 或展開時可見即可。
- `openEmployeeEditor` modal：在「地址」欄位之後新增 `<textarea>` 欄位，label「備忘」，placeholder「內部備忘（不會顯示給客戶）」，rows=3。
- 儲存時將 notes 帶入 PUT body。

### 5. LINE Bot（management.handler.ts）

- `listEmployees` 回覆：若 `employee.notes` 有值，在該員工資訊後附加一行「備忘：<notes>」。
- notes 超過 30 字時截取前 30 字 + `...`，避免 LINE 訊息過長。

## Acceptance

| # | 驗收條件 | 驗證方式 |
|---|---------|---------|
| 1 | 後台新增員工可填 notes，儲存後重新開啟 modal 值不變 | 手動操作 |
| 2 | 後台編輯既有員工可新增/修改/清空 notes | 手動操作 |
| 3 | notes 為空時不影響任何既有流程（nullable，無必填驗證） | 既有員工資料不報錯 |
| 4 | LINE Bot 「員工清單」指令顯示有 notes 的員工附帶備忘行 | LINE chat 測試 |
| 5 | LINE Bot 顯示 notes 超過 30 字時截斷為 30 字 + `...` | 填長文測試 |
| 6 | **多租戶隔離**：employee CRUD 全部帶 `where: { tenantId }`，notes 讀寫不跨租戶 | 確認 service 層既有 tenantId 過濾覆蓋 notes |
| 7 | **Idempotency**：PUT 同樣的 notes 值多次，結果一致不報錯 | 重複送出測試 |
| 8 | **空字串處理**：notes 傳空字串 `""` 時存為 `null`，前端顯示空白 | API 測試 |
| 9 | 滾動部署期間舊版 code 不因新欄位報錯（nullable 欄位不影響舊 select/insert） | 部署觀察 |

## Out of scope

- 不做 notes 全文搜尋（後台搜尋不 query notes 欄位）。
- 不做 notes 歷史紀錄 / 版本追蹤。
- 不做 notes 字數上限驗證（前端 textarea 可選擇性加 maxlength，但 API 層不卡）。
- 不做 FeatureFlag 控制（所有 Tenant 共用）。
- 不做 LINE Bot 端寫入 notes（只有後台可編輯）。
- 不做 notes 顯示在 PDF / Excel 匯出中。

## 受影響檔案

| 檔案 | 變更 |
|------|------|
| `prisma/schema.prisma` | Employee model 加 `notes String?` |
| `src/modules/core/employee/employee.service.ts` | create/update data 型別加 notes |
| `src/modules/core/employee/employee.router.ts` | POST/PUT body 接受 notes |
| `public/admin/app.js` | openEmployeeEditor 加 textarea；viewEmployees 無變更 |
| `src/line/handlers/management.handler.ts` | listEmployees 顯示 notes（截取 30 字） |
