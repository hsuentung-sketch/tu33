# ERP TODO

整合所有 Phase B+ 待辦項目，按主題分區。CLAUDE.md「未完成 / 待驗證」段為對應索引。

> 每完成一項，刪除該行；若項目升級為正在進行中，加 `🚧` 標記。

---

## Phase B — 會計擴充（接續 v2.7.x Phase A）

### 自動分錄 hooks（user 待通知正式啟用）
- [ ] 銷貨單過帳 → `Dr 1131 應收帳款 / Cr 4101 銷貨收入 + 2131 銷項稅額`
- [ ] 進貨單過帳 → `Dr 1411 存貨 + 2132 進項稅額 / Cr 2101 應付帳款`
- [ ] 收款 → `Dr 1101/1111 / Cr 1131 應收帳款`
- [ ] 付款 → `Dr 2101 應付帳款 / Cr 1101/1111`
- [ ] 電子發票開立成功 → 已隱含於銷貨 hook
- [ ] 折讓單開立 → `Dr 4101 銷貨折讓 + 2131 / Cr 1131`

### 進階會計流程
- [ ] **薪資代扣明細**：發薪時拆 Dr 6101 薪資 / Cr 1111 銀行 + 2XXX 代扣健保 / 勞保 / 所得稅
- [ ] **零用金 imprest 模式**：固定額度 + 補差額自動算
- [ ] **員工借支**：應收員工借支 1141；扣薪沖銷
- [ ] **JE 模板系統**：ADMIN 維護常用借貸對照（取代 expense.service 寫死的關鍵字表）
- [ ] **折讓單前端 UI**：service 已有 D0401/D0501 builder，缺 admin 介面
- [ ] **載具明細管理**：手機條碼 / 自然人憑證 / 會員載具

### 報表 / 申報
- [ ] **401 申報報表**：兩月一期，銷項/進項稅額彙總
- [ ] **銀行對帳（reconciliation）**：銀行對帳單 vs DB 比對
- [ ] **現金流量表（cash flow statement）**：間接法
- [ ] **月結對帳單 PDF**（客戶/供應商）
- [ ] **銷售報表**：毛利分析、月度趨勢
- [ ] **科目明細帳 / 總分類帳**檢視

---

## Phase B — 電子發票擴充

- [ ] 🚧 **NTP 對時改用 RFC 5905**：目前 boot-check 用 worldtimeapi.org HTTP，正式應走 UDP NTP server
- [ ] 🚧 **載具/捐贈 LINE 流程**：B2C 客戶在 LINE 上選載具 / 輸入捐贈碼
- [ ] 🚧 **電子發票 LIFF**：手機/平板開立發票流程

---

## Phase B — 一般 ERP

### LINE / LIFF
- [ ] 銷貨單「送貨備註」在 LINE chat 流程沒有收集（PDF 會留空）
- [ ] 報價追蹤流程（從 LINE Rich Menu 進入）尚未實作
- [ ] LIFF 銷貨/進貨表單（autocomplete 體驗，類似 LIFF 報價單）
- [ ] 語音開單（Whisper）整合測試

### 後台擴充
- [ ] 報價 / 銷貨 / 進貨的**建單 UI**（目前只能查）
- [ ] 員工自改密碼 UI
- [ ] 審計日誌（AuditLog）檢視
- [ ] tenant-level 設定頁（稅率、單號前綴、PDF 頁尾…）
- [ ] 多公司複製流程的管理介面

### 推播 / 排程
- [ ] 逾期帳款 LINE 推播（cron job）
- [ ] 月結請款日提醒（cron）

### 庫存
- [ ] 庫存追蹤（進銷存連動，目前 v2.x 後台只看快照）
- [ ] 庫存盤點 UI

---

## 維護 / 技術債

- [ ] **`branchId` 欄位無 Branch model**：v2.6.0 預留欄位但無 FK；待多分店需求出現時建立 Branch model
- [ ] **`@prisma/streams-local` engine warning**：`required: { node: '>=22.0.0' }` 但 Fly 跑 Node 20，目前無實際問題
- [ ] **9 vulnerabilities (2 low, 7 moderate)** in npm deps — 跑 `npm audit` 評估
- [ ] **Prisma 7.7 → 7.8** 升級（Fly build log 有提示）
