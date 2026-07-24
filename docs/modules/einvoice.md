# 電子發票（Einvoice, MIG 4.1）

依據財政部「電子發票 Turnkey 上線前自行檢測作業 V4.8」（113-12-30 發布，MIG 4.1 規範）重構升級。

## Trigger

### 開立
- **銷貨單建立/完成時**（依 tenant.settings.einvoice.autoIssue）自動開立 F0401 存證發票
- **後台手動**：應收帳款頁 → 「開立發票」按鈕（僅未開立過的可按）
- **LINE 手動**：目前不做（電子發票操作精細，走後台為主）

### 作廢
- 後台電子發票頁 → 該筆「作廢」按鈕
- 觸發 F0501 送 EINV

### 註銷（新增）
- 後台電子發票頁 → 該筆「註銷」按鈕（限已作廢的發票）
- 觸發 F0701 送 EINV
- 用途：發票內容錯誤，需正式撤銷後重新開立

### 折讓
- 應收帳款頁或發票頁 → 「開立折讓單」→ 觸發 G0401
- 折讓單作廢：觸發 G0501

### 空白字軌回報（E0402）
- **自動排程**：每期（雙月）10 號前自動觸發，回報本期未使用的字軌
- 期別以民國年月表示（如 11202）

### 對帳
- **每日 03:30 自動排程**：比對 ERP 已開發票筆數 vs Turnkey SummaryResult 成功筆數
- 發現漏傳/失敗自動 email + LINE 通知 ADMIN

## Scope

### 涵蓋
1. **F0401 開立發票**（B2C 存證，含買方有無統編兩情境）
2. **F0501 作廢發票**
3. **F0701 註銷發票**（新增）
4. **G0401 折讓證明單**（賣方開立）
5. **G0501 作廢折讓證明單**
6. **E0402 空白未使用字軌檔**（自動排程）
7. **對帳排程**（漏上傳/E 狀態異常）
8. **模組層 opt-in**：`modules.json` 粗顆粒開關

### 稅別支援（MIG 4.1 金額分區）
| TaxType | 名稱 | SalesAmount | FreeTax | ZeroTax | TaxAmount |
|---|---|---|---|---|---|
| 1 | 應稅 | > 0 | 0 | 0 | Sales × 稅率 |
| 2 | 零稅 | 0 | 0 | > 0 | 0 |
| 3 | 免稅 | 0 | > 0 | 0 | 0 |
| 9 | 混稅 | > 0 | > 0 | 0 | 依 Sales 部分算稅 |

### 載具情境
- **手機條碼**（3J0002）：CarrierId1=顯碼 / CarrierId2=隱碼可不同（本次重構要拆分）
- **自然人憑證**（CQ0001）：2 碼英文大寫 + 14 碼數字
- **會員載具**（EJ0113）：需另申請，本次先支援 schema，實際會員載具啟用列 P2
- **無載具**：PrintMark=Y 印證明聯
- **捐贈**：DonateMark=1 + NPOBAN 3-7 碼

### 賣方資訊必填欄位（MIG 4.1）
- Identifier（統編，從 tenant.taxId，不再從 einvCfg.sellerTaxId 讀）
- Name（稅籍登記名稱）
- Address
- **PersonInCharge**（負責人姓名）
- **TelephoneNumber**（電話）
- FacsimileNumber（傳真，選填）

以上都存 `Tenant.settings.einvoice.*` 或 `Tenant` 主表欄位。

### 模組層 opt-in（粗顆粒）
`tenants/<客戶>/modules.json`：
```json
{
  "modules": {
    "einvoice": {
      "enabled": true
    }
  }
}
```

- `enabled: true` → 後台顯示發票分頁、字軌配號、對帳頁；LINE handler 開票流程生效
- `enabled: false` → 相關功能全部隱藏，銷貨單建立時不觸發發票

**營運層開關**（同時檢查）：
- `Tenant.settings.einvoice.enabled` 為運行時開關（用於「模組啟用但 Turnkey 尚未申請完成」的過渡期，可讓後台顯示但暫不送 EINV）

## Acceptance Criteria

### 訊息代碼
1. XML 產出的 root element namespace 為 `F0401:4.1` / `F0501:4.1` / `F0701:4.1` / `G0401:4.1` / `G0501:4.1`（非 C/D 系列）
2. 手動送一份 sample F0401 XML 到 Turnkey → 15 分鐘內狀態變 C（存證成功）
3. 手動觸發 F0501 作廢 → Turnkey 回覆成功
4. 手動觸發 F0701 註銷 → Turnkey 回覆成功
5. 手動觸發 G0401 折讓 → Turnkey 回覆成功
6. 手動觸發 G0501 作廢折讓 → Turnkey 回覆成功

### 稅別金額
7. TaxType=1 應稅：`SalesAmount > 0`，`FreeTaxSalesAmount = 0`，`ZeroTaxSalesAmount = 0`
8. TaxType=2 零稅：`SalesAmount = 0`，`ZeroTaxSalesAmount > 0`，`TaxAmount = 0`
9. TaxType=3 免稅：`SalesAmount = 0`，`FreeTaxSalesAmount > 0`，`TaxAmount = 0`
10. TaxType=9 混稅：`SalesAmount > 0` 且 `FreeTaxSalesAmount > 0`

### 載具/捐贈
11. 手機條碼 CarrierId1 / CarrierId2 可獨立填入且輸出到 XML 對應欄位
12. 捐贈時 PrintMark=N, DonateMark=1, NPOBAN 填入
13. 有統編時（Buyer.Identifier 8 碼）不可同時有載具/捐贈

### 對帳排程
14. 每日 03:30 自動比對 issued vs uploaded vs confirmed
15. 有漏傳/E 狀態自動 email 通知
16. Turnkey SummaryResult XML 有解析並更新 Einvoice.status

### E0402 排程
17. 每期（雙月）10 號 09:00 自動觸發
18. 未使用字軌 range 送出後標記已回報，避免重送

### 模組層 opt-in
19. `tenants/<客戶>/modules.json` einvoice.enabled=false 時，後台隱藏發票相關分頁
20. `sales-order.service.ts` 建立銷貨單時，若模組關閉不觸發發票開立
21. 潤樋 (`tenants/潤樋/modules.json`) einvoice.enabled=true

### 通用
22. `npx tsc --noEmit` 通過
23. 現有 einvoice 資料保留（不 migrate 舊 C 系列，只影響新開發票走 F 系列）
24. 部署 Fly → 前端 admin manual.md 版本更新

## Out of Scope

- **B2B 交換發票 A0101/A0102/A0201/A0202/A0301/A0302 / 交換折讓 B0101/B0102/B0201/B0202**：潤樋客戶為「B2C 存證 + 買方有統編」（走 F0401 情境 2），非真正 EDI 交換。若未來有客戶需要真正 B2B 交換，另開 sprint
- **會員載具啟用**：schema 支援，實際啟用要另申請 EJ0113 載具，未在此範圍
- **E0401 分支機構配號檔**：潤樋單一機構，暫不做
- **正式環境切換**：先在測試環境（tsftp.einvoice.nat.gov.tw）完成檢測；通過核發上線通行碼後才切正式
- **InvoiceType "08" 特種稅額**：本次維持 "07"，特種稅需求出現再處理
- **舊 C 系列已上傳資料 migration**：保留為歷史，不重傳
- **QR AES key 自動輪替**：手動設定即可
- **細顆粒模組 flag**（sub-features）：本次粗顆粒即可

## 相關檔案

- 檢測標準：`docs/audit/einvoice-v4.8-gap.md`
- Turnkey 建置 runbook：`D:\Claude\obsidian\Runbooks\einvoice-turnkey-linode-setup.md`
- 主要程式碼：`src/modules/accounting/einvoice/`
- Schema：`prisma/schema.prisma` model Einvoice / EinvoiceItem / EinvoiceAllowance / EinvoiceAllowanceItem / EinvoiceNumberPool
- 前端：`public/admin/app.js` viewEinvoices / viewEinvoicePools
- 租戶設定：`tenants/<客戶>/modules.json`

## 部署順序（避免中斷現有服務）

1. Phase A 模組層先上（不影響現有發票流程）
2. Phase B XML builder：改完先本地 tsc + 單元測試，不部署，等 Phase C-F 都寫完一起發
3. Phase C F0701 註銷：schema 加欄位需 prisma db push；先在測試環境驗證
4. Phase D 對帳排程：新 cron，加 kill switch (`settings.einvoice.reconcileEnabled`) 可隨時關
5. Phase E E0402 排程：新 cron，加 kill switch
6. Phase F 收尾 → E2E 測試 → 版本 bump → fly deploy

## 風險與 mitigation

| 風險 | Mitigation |
|---|---|
| C→F 全改後現有 pending 發票會失敗 | Phase B 上線前先確認 Einvoice 表 status=PENDING 為 0（把所有 pending 走完） |
| Turnkey 若不接受 F 系列（版本不合） | 上線前用一份 sample F0401 手動送 Turnkey 測，確認接受 |
| Cron 起火時段 Fly 剛好在部署 | 對帳/E0402 cron 加 lock（Prisma table + advisory lock）避免重複跑 |
| 潤樋現有 C 系列已開發票要不要重送 | 不重送，維持歷史狀態；新開發票才走 F |
