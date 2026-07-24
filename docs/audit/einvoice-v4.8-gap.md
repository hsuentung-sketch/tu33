# ERP einvoice 模組 vs EINV V4.8 檢測要求 — 差距分析

> 稽核日期：2026-07-24
> 標準：財政部「電子發票 Turnkey 上線前自行檢測作業 V4.8」（113-12-30 發布，MIG 4.1）
> ERP 端：`src/modules/accounting/einvoice/`

## 一、訊息代碼對照（★關鍵）

實作全部走 **C/D 系列**（大平台加值中心通道），不是 F/G 系列（存證通道）。V4.8 檢測作業把訊息代碼定義為「上傳存證」用 F/G，「交換發票」用 A/B。這是 **P0 認定風險**。

| V4.8 要求 | ERP 現況 | 差距 | 難度 |
|---|---|---|---|
| F0401 開立（存證） | 走 **C0401**（`xml-builder.ts:176` namespace `C0401:4.1`） | 訊息代碼 & namespace 不符 | 中 |
| F0501 作廢 | 走 **C0501**（`xml-builder.ts:347`） | 同上 | 中 |
| **F0701 註銷發票** | **完全未實作** | 沒有 F0701 builder 也沒有 service | 大 |
| G0401 折讓 | 走 **D0401**（`xml-builder.ts:257`） | 訊息代碼 & namespace 不符 | 中 |
| G0501 作廢折讓 | 走 **D0501**（`xml-builder.ts:295`） | 同上 | 中 |
| A0101/A0102 等交換發票 | **完全未實作**（B2B 有統編也走 C0401） | 需完整 A 系列 + 買方確認回覆流程 | 大 |
| B0101–B0202 交換折讓 | **完全未實作** | | 大 |
| E0401 分支配號 | **完全未實作** | 有 `branchId` 欄位但無下發 XML | 中 |
| E0402 空白未使用字軌 | 有 **C0701** builder，但**無排程/service 呼叫** | 需自動觸發（每期 10 號前） | 中 |

> **關鍵判斷**：若檢測機關要求 F/G 而 ERP 給 C/D，Turnkey 端接不接受依 Turnkey 版本而異。**建議先與 Turnkey 供應商確認**——不在 ERP 程式碼內能決定。

## 二、XML 欄位齊全度（MIG 4.1）

**C0401**（`xml-builder.ts:133-207`）：
- ✅ InvoiceNumber / InvoiceDate / InvoiceTime / Seller(Id/Name/Address) / Buyer(Id/Name/Address) / RandomNumber / DonateMark / PrintMark / Details / Amount
- ✅ MIG 4.1 新增：MainRemark / CustomsClearanceMark / ZeroTaxRateReason
- ❌ 缺 **Seller.PersonInCharge / TelephoneNumber / FacsimileNumber**（V4.8 明示「賣方公司資訊都要正確」）
- ❌ 缺 **FreeTaxSalesAmount / ZeroTaxSalesAmount**（**P0**，混稅/零稅/免稅無法產出正確 XML）
- ⚠️ `InvoiceType` 恆為 "07"，特種稅額（08）無法處理
- ⚠️ 品項 `Amount` 用 `toFixed(0)` 強制整數，MIG 4.1 允許 2 位小數

**D0401**：
- ❌ `AllowanceType` 寫死 "1"（買方=1/賣方=2/雙方=3 應區分）
- ❌ Amount 區缺 `TaxType`

## 三、載具/捐贈情境

- ✅ 手機條碼 3J0002 / 自然人憑證 CQ0001 / 會員載具 EJ0113 驗證正確
- ✅ 捐贈 NPOBAN 3-7 位數字驗證
- ✅ 載具/捐贈 + 有統編互斥
- ✅ DonateMark=1 + printFlag='N' 自動連動
- ⚠️ **CarrierId1 = CarrierId2 塞同一值**（`xml-builder.ts:159-160`），MIG 定義 Id1=顯碼 Id2=隱碼可能不同

## 四、稅別處理（P0）

`einvoice.service.ts:378`：只算應稅（1）稅額，其他 taxType 塞 0。

- ❌ **零稅 / 免稅 / 混稅金額欄位錯誤**：一律塞 `<SalesAmount>`，另外 `FreeTaxSalesAmount` / `ZeroTaxSalesAmount` 沒輸出
- ❌ **混稅（9）未支援**：無自動偵測 items 多種 taxType、無拆三欄
- ✅ 零稅率必填 CustomsClearanceMark 有擋

## 五、前置作業檢測項次 1-4 告警機制

| V4.8 要求 | ERP 現況 | 差距 |
|---|---|---|
| 字軌誤用告警 | 硬性 filter 未配到就拋錯，無 email/notification hook | 需告警機制 |
| 重號檢核 | Prisma unique 保護單租戶 | 沒有跨店掃描告警 |
| 漏上傳每日對帳 | **無** | **P0**（項次 3 必檢） |
| Turnkey E 狀態處理 | 只認 filename REJECTED/CONFIRMED 關鍵字，未讀 SummaryResult / ProcessResult | **P0** |

## 六、Turnkey 整合

- 檔案傳遞：`turnkey-storage.ts` 兩後端 — `local`（絕對路徑 FS）+ `s3`（R2/Tigris/MinIO/AWS）
- 跨主機（ERP 在 Fly / Turnkey 在 Linode 172.104.74.184）：架構註解建議 Fly 寫 S3、Linode 端 rclone 拉；**ERP 本身不 push 到 Linode**
- 需確認 Linode 側 rclone 是否已設（不在 ERP 程式碼範圍）
- Reader 極簡：filename regex 抓 invoiceNo + REJECT 關鍵字，**未解析 XML 回覆碼**

## 七、字軌池管理

- ✅ 匯入平台配號 CSV（`einvoice.service.ts:145-205`）
- ✅ 期別格式驗證（民國 3+2+2 = 7 碼）
- ✅ 分支隔離（`branchId`）
- ❌ 無「非當期字軌」告警
- ❌ 無「即將耗盡」提示

## 八、E0402 空白未使用字軌檔

- `buildC0701`（`xml-builder.ts:323`）builder 存在
- ❌ 無排程 job 呼叫、無 service function、無 Prisma 欄位追蹤已回報 range

## 九、多租戶 opt-in

- ✅ `EinvoiceSettings.enabled`（`utils.ts:208`）總開關
- ✅ `turnkey-reader.ts:34` 檢查 `cfg.enabled && cfg.turnkeyOutboundDir`
- ⚠️ 未看到 `tenants/潤樋/modules.json` einvoice 條目（本次未 audit）

## 十、優先修復清單

### P0（檢測會直接失敗）
1. **零稅/免稅/混稅金額欄位錯誤**：C0401 XML 缺 `FreeTaxSalesAmount` / `ZeroTaxSalesAmount`
2. **F0701 註銷發票** 完全未實作
3. **漏上傳每日對帳** 無排程 job
4. **Turnkey SummaryResult / ProcessResult 未解析**
5. **訊息代碼 C0401 vs F0401** 需與 Turnkey 供應商確認
6. **CarrierId1 / CarrierId2 塞同一值**

### P1（檢測可能被打回）
7. E0402 空白字軌無排程觸發
8. Seller 缺 PersonInCharge / TelephoneNumber
9. AllowanceType 寫死 "1"
10. B2B 有統編仍走 C0401 而非 A0101/A0102
11. 字軌誤用/重號無告警通知
12. `allowance.service.ts:56-57` 讀 `einvCfg.sellerTaxId` override（`issue()` 已改用 tenant.taxId 但 allowance 沒同步）

### P2（營運/加分）
13. E0401 分支配號 XML
14. B2B 交換發票確認回覆流程
15. `InvoiceType` 永遠 "07"
16. 字軌池「即將耗盡」提示
17. 折讓單前端輸入介面

---

**架構總評**：核心 XML builder、字軌池、Turnkey I/O、載具驗證、二份備份（DB xmlBody + FS 檔）都已到位且結構清爽；主要差距集中在 **(a) 訊息代碼族 (C vs F)**、**(b) 稅別金額分區欄位**、**(c) 對帳/告警排程 job**、**(d) F0701 與 E0402 的觸發端**。

- XML 級改動：1-2 天
- 排程/告警 job：3-5 天
- opt-in 模組層整合：0.5 天
