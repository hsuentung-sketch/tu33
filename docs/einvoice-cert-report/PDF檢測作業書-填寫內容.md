# 電子發票 Turnkey 上線前自行檢測作業 — 填寫內容

> **用途**：將此文件內容填入官方 PDF（`電子發票.pdf` V4.8.1 115/8/20）對應欄位。
> 官方 PDF 上傳位置：wwwtest.einvoice.nat.gov.tw → 營業人功能選單 → Turnkey → Turnkey 上線前自行檢測作業 (BTB036W)。

---

## 貳、申請檢測業者資訊

| 欄位 | 值 |
|---|---|
| 營業人名稱 | 潤樋實業有限公司 |
| 營業人統一編號 | 62198132 |
| 申請業者類型 | ☑ 營業人（存證） □ 加值中心 |
| 檢測人員姓名 | 董旭恩 |
| 聯絡電話 | 0970-543779 |
| 電子郵件 Email | hsuentung@gmail.com |
| 完成檢測日期 | 2026 年 9 月 11 日 |

---

## 參、Turnkey 上線自行檢測

### 二(一) 電子發票作業檢測

#### 項次 1 — 字軌檢核
- ☑ **通過**（(1) 營業人系統）
- ☑ **非加值中心**（(2) 加值中心 skip）

**佐證畫面與說明**：
```
系統於 /admin/#invoices/einvoice-cert 檢測儀表板實作 A1「字軌檢核」，
內容包含：
  • 匯入 EINV 大平台字軌配號 CSV 功能（tools/add-number-pool CLI 亦支援）
  • 檢核每張上傳發票號碼是否落在當期字軌區間、是否用電子發票專用字軌
  • 儀表板即時顯示「當期字軌剩餘 %」，剩 <10% 觸發 LINE 告警給 ADMIN + ACCOUNTING 角色
  • 每日 03:30 自動對帳 job (src/jobs/einvoice-recon.ts) 檢查「字軌即將耗盡」
  • 前後端於 einvoice.service.ts allocateNumber() 用 optimistic concurrency
    (UPDATE ... WHERE nextNumber = expected) 保證併發下無重號、無跳號
佐證截圖：docs/einvoice-cert-evidence/phase-a/A1-A2-pool-and-duplicate-check.jpg
```

#### 項次 2 — 重號檢核
- ☑ **通過**（(1) 營業人系統）
- ☑ **非加值中心**（(2) skip）

**佐證畫面與說明**：
```
系統於 Prisma schema Einvoice model 對 (tenantId, invoiceNo) 加
@@unique constraint，DB 層防止重號寫入；service 層額外先查詢是否
已存在同號 → 存在則 throw P2002。壓力測試 1000 張 (2026-08-18)
全數無跳號、無重號，驗證 optimistic concurrency 邏輯正確。
儀表板 A2 顯示「目前資料庫中無任何重號發票」綠底提示。
佐證截圖：docs/einvoice-cert-evidence/phase-a/A1-A2-pool-and-duplicate-check.jpg
```

#### 項次 3 — 漏上傳檢核
- ☑ **通過**（(1) 營業人系統）
- ☑ **單一機構或分支機構自行上傳**（(2) 分支機構情境 skip，潤樋單一機構）
- ☑ **非加值中心**（(3) skip）

**佐證畫面與說明**：
```
系統每日 03:30 執行對帳 cron (src/jobs/einvoice-recon.ts)：
  • 掃描過去 24 小時開立的發票
  • 與 Turnkey Web API SummaryResult 對比
  • 針對「開立但未收到平台確認」的發票標記 stuck
  • 若 stuck > 0 或漏上傳 > 0 → LINE 告警給 ADMIN + ACCOUNTING
  • 儀表板 A3 顯示「過去 24 小時：開立 X / 已確認 Y / 拒絕 Z」
佐證截圖：docs/einvoice-cert-evidence/phase-a/A3-A4-recon-and-alert.jpg
```

#### 項次 4 — 發票異常處理檢核
- ☑ **通過**（(1) 每日處理 Turnkey 錯誤訊息）
- ☑ **通過**（(2) 每日比對筆數）
- ☑ **非加值中心**（(3) skip）

**佐證畫面與說明**：
```
(1) Turnkey 錯誤處理：Turnkey 每日排程 UpCast→Pack→SendFile 全走過，
    ReceiveFile 收 EINV 的 ProcessResult，錯誤訊息寫入 MariaDB LOG_MESSAGE 表。
    ADMIN 可從 Turnkey GUI 「檢視訊息紀錄」查詢 P/G/C/I/E 狀態。
    E 狀態發票由後台儀表板 A3 標記為 rejected 並 LINE 告警。
(2) 每日 03:30 對帳 job 自動比對 Fly DB 開立筆數 vs Turnkey SummaryResult。
    差異 > 0 觸發告警。
佐證截圖：docs/einvoice-cert-evidence/phase-a/A3-A4-recon-and-alert.jpg
```

#### 項次 5 — 會員中獎通知檢核
- ☑ **無提供會員載具**（潤樋商業模式為 B2B 應收/銷貨，未實際營運會員載具）

**佐證畫面與說明**：
```
潤樋實業為 B2B/B2C 混合經營，實際商業模式無提供會員載具會員機制。
Phase B 檢測情境 B03/B12 使用會員載具 (EJ0113 test@example.com) 僅供
系統功能檢測用。系統不承接會員載具中獎清冊功能。
若未來啟用會員載具營運，將另行完成歸戶測試並補做中獎清冊下載機制。
```

---

### 二(二) 軟硬體設備環境檢測

#### STEP 1 — 防火牆設定
- ☑ SFTP 設定開啟 Port:2222 → Linode 172.104.74.184 對外 IP 已在 EINV 平台「傳輸業者資訊」登錄
- ☑ Web API 設定開啟 Port:443(https) → Linode 對 gw.einvoice.nat.gov.tw / tgw.einvoice.nat.gov.tw 通訊已測試通過

#### STEP 2 — Web 平台設定
- ☑ 1. 大平台完成營業人註冊（正式與測試站皆已註冊）
- ☑ 2. 主憑證資料登錄（工商憑證 MOEACA RT33.pfx，62198132）
- ☑ 3. 軟體憑證登錄（62198132_20260806155022.pfx，5 年效期，由主憑證授權）
- ☑ 4. 營業人接收方式設定（測試站 SFTP 設定完成，正式站待通行碼下來後補做）

#### STEP 3 — Turnkey (EINVTurnkey) 設定
全項 ☑ 完成，設定於 Linode VM 172.104.74.184 /opt/turnkey/app/linux/EINVTurnkey/：
- ☑ 1. 憑證管理（Turnkey GUI 匯入 62198132_20260806155022.pfx）
- ☑ 2. 傳送帳號管理（TU33 / 33tu33TU）
- ☑ 3. 送方管理（TU33 代碼 + 繞送代碼從 EINV 平台查得）
- ☑ 4. 收方管理（潤樋非 B2B 交換型，僅存證，此項雖非必要仍設定完備）
- ☑ 5. 系統環境設定（測試環境 tsftp.einvoice.nat.gov.tw:2222 + Gmail SMTP 通知）
- ☑ 6. 目錄設定（存證：MIG 4.1 UTF-8）
- ☑ 7. 發票配號訊息目錄設定（MIG 4.1）
- ☑ 8. 下載流程目錄設定（與上傳一致）
- ☑ 9. 排程設定（Upload/Download/CleanFile 皆已啟用）
- ☑ 10. 傳輸結果確認（每張發票 C 狀態才計入成功）

#### 傳輸結果確認
- ☑ 已建立確認機制

#### 現行發票數量
- 每週最大發票數量為 **200** 筆
- 每月最大發票數量為 **800** 筆

---

### 三、上傳作業檢測
潤樋為存證營業人，不做 B2B 交換 → 執行「附錄二、存證發票作業檢測」，見末段。

---

### 四、上傳結果檢測

#### 項次 1 — Turnkey 確認 ★必要★
- ☑ **通過**

**佐證畫面與說明**：
```
1. 交易日誌查詢：Turnkey GUI 提供「檢視訊息紀錄」與「統計訊息記錄查詢」，
   可依作業時間查詢 P/G/C/I/E 狀態。
2. 系統檢核機制：對帳 job 每日 03:30 自動核對 Turnkey 主機
   SummaryResult 及 ProcessResult 的上傳筆數與實際上傳筆數，
   差異 > 0 觸發 LINE 告警 (LINE 告警機制詳見項次 3-4)。
3. 樣本發票 (2026-08-18 壓力測試 LO 系列 1000 張) 全數皆有 C 狀態確認。
佐證截圖：docs/einvoice-cert-evidence/phase-d/D1-systemd-turnkey.png
      docs/einvoice-cert-evidence/phase-d/D3-recon-alert.jpg
```

#### 項次 2 — Web 大平台查詢確認 ★必要★
- ☑ **通過**

**佐證畫面與說明**：
```
執行 wwwtest.einvoice.nat.gov.tw → 營業人功能 → 查詢與下載
→ 發票查詢/列印/下載 → 匯出 Excel 5 份：
  • 開立已確認 23 張 F0401（einv-export-all-issued.xlsx）
  • 已作廢 JZ50075670（einv-export-void-1150708.xlsx）
  • 已註銷 JZ50075672（einv-export-nullify-1150708.xlsx）
  • 折讓已確認 AL20260816005 / AL20260906001（einv-export-allowance-*.xlsx）
  • 折讓作廢 AL20260906001（einv-export-allowance-1150910.xlsx）
每張皆對得上系統 einvoice 表狀態，無差異。
佐證檔案：docs/einvoice-cert-evidence/phase-b/einv-export-*.xlsx
```

---

### 五、電子發票專用字軌檢測

#### 項次 1 — E0401 分支機構配號檔
- **不適用**：潤樋為單一機構，無分支機構

#### 項次 2 — E0402 空白未使用字軌檔 ★必要★
- ☑ **通過**

**測試統編**：62198132（潤樋，總公司統編）

**測試內容**：
```
測試日期：2026-09-10
測試期別（YearMonth）：11508 (民國 115 年 7-8 月期別)
測試字軌：JZ
空白起號：50075681
空白迄號：50075699

Turnkey UpCast → BAK ✓
Turnkey Pack → BAK ✓
Turnkey SendFile → BAK（SFTP 送出 EINV）✓
Turnkey ReceiveFile → Unpack/BAK/ProcessResult ✓（EINV 已回覆處理結果）

備註：本潤樋部署歸類 Turnkey 對 E 系列訊息掃描 B2PMESSAGE 而非 B2SSTORAGE，
      Linode crontab 加自動搬檔機制確保 Fly 產出的 E0402 XML 路由到正確位置。
```

---

## 附錄二、存證發票作業檢測

### 一、壓力測試

- **測試日期**：2026 年 8 月 18 日
- **測試發票號碼**：LO99980950 ~ LO99981949（共 1000 張）
- **結果**：ERP 端 1000/1000 成功（100%），平均 ~1 張/秒；R2 → Linode 全鏈路 0 掉件；證明系統可穩定處理批量發票

### 二、存證檢測情境（18 情境）

| 項次 | 情境 | 發票號碼 / 折讓單號 | 說明 |
|---|---|---|---|
| **1-1** | F0401 開立-買方為消費者 | JZ50075659 | B05 列印無載具，B2C |
| **1-2** | F0401 開立-買方有打統編 | JZ50075668 | B2B 應稅 |
| **2** | F0401 列印證明聯（未使用載具）| JZ50075659 | PrintMark=Y |
| **3** | F0501 作廢發票（消費者取消交易）| JZ50075670 | 修正版 flat 結構 |
| **4-1** | F0701 註銷（開→廢→註銷→重開）| LP50706903 → LP50706904 | 完整流程驗證 |
| **4-2** | F0701 註銷（開→註銷→重開）| JZ50075672 | 直接註銷 |
| **5** | G0401 折讓（消費者退換貨）| 發票 JZ50075669 / 折讓 AL20260906001 | 折讓 105 元 |
| **6** | G0501 作廢折讓證明單 | AL20260906001 | EINV 端「作廢已確認」|
| **7** | F0401 持手機條碼索取 | JZ50075655 | CarrierType=3J0002 `/ABC1234` |
| **8** | F0401 捐贈發票 | JZ50075658 | NPOBAN=919 |
| **9** | F0401 持載具+捐贈（手機條碼）| LP50706900 | 3J0002 `/ABC1234` + 捐贈 919 |
| **10** | F0401 手機條碼報核作業 | LP50706906 | B2B 12345678 + 手機條碼 `/DEF1234` |
| **11** | F0401 持會員載具 | JZ50075657 | EJ0113 test@example.com |
| **12** | F0401 持會員載具+捐贈 | LP50706901 | EJ0113 + 捐贈 919 |
| **13** | F0401 持自然人憑證條碼 | JZ50075656 | CQ0001 AB12345678901234 |
| **14** | F0401 持載具+捐贈（自然人憑證）| LP50706902 | CQ0001 + 捐贈 919 |
| **15** | F0401 開立應稅發票 | JZ50075661 | TaxType=1 |
| **16** | F0401 開立零稅發票 | JZ50075678 | TaxType=2, 零稅原因 71 外銷貨物 |
| **17** | F0401 開立免稅發票 | JZ50075663 | TaxType=3 |
| **18** | F0401 開立混稅發票 | JZ50075660 | TaxType=9 |

**驗證方式**：
每筆均可於 wwwtest.einvoice.nat.gov.tw 銷項查詢 / 折讓單查詢 / 作廢 / 註銷等頁面查得對應紀錄，佐證 Excel 檔已備妥於檢測文件附件。

---

## 送審檔案清單

1. 本填寫內容（Word/PDF 版本）
2. `潤樋電子發票V4.8檢測報告.docx`（系統設計 + 測試過程完整說明）
3. `docs/einvoice-cert-evidence/` 全部佐證（Excel 匯出、截圖、CLI 輸出）
