# Module Library -- ERP 可用模組總覽

> 供 industry-analyst agent 參考。依模組 key 分類，標註「標準 / 選配 / 客製」。
> 標準 = 所有行業都用；選配 = 部分行業需要，已有程式碼；客製 = 需開發。
>
> 模組 key 對照見 `docs/module-keys.md`（唯一真相來源）。

## 核心模組（所有行業標準配備）

| key | 模組名 | 說明 | 子功能 |
|-----|-------|------|--------|
| (core) | 員工 | Employee CRUD + LINE 綁定 + 密碼 + 角色 | employee.router, employee.service |
| (core) | 租戶 | Tenant 設定 + 公司資料 + 模組開關 | tenant.router |
| (core) | 驗證 | LINE LIFF + Web cookie + API token | auth.middleware, web-auth.router, liff-auth.middleware |
| (core) | 版本 | 版本發布 / 訂閱 / 自動升級 / rollback | version.service, version.router |
| (core) | 計費 | SaaS 計費 + 方案管理 + 用量上限 | billing.service, billing-advanced.service |
| (core) | Feature Gate | 模組權限閘道 + 用量檢查 | feature.service, feature.router |
| (core) | 短連結 | JWT 簽名短 URL（PDF 下載用） | shortlink.service |
| (core) | 稽核 | AuditLog 寫入 + 查詢 | audit-log.router |
| (core) | 錯誤紀錄 | ErrorLog 持久化 + 後台檢視 | error-log.router |
| (core) | License | CP license 驗證 + release poll | license-check.ts, license-middleware.ts |

## 主檔模組

| key | 模組名 | 類型 | 說明 |
|-----|-------|------|------|
| customers | 客戶 | 標準 | CRUD + 搜尋 + 名片 OCR + LINE chat 新增 |
| suppliers | 供應商 | 標準 | CRUD + 搜尋 + 文件上傳 |
| (core) | 產品 | 標準 | CRUD + 模糊搜尋 + 建議售價/參考進價 + 文件(PDS/SDS/DM) |

## 業務模組

| key | 模組名 | 類型 | 說明 | 子功能 |
|-----|-------|------|------|--------|
| sales | 報價單 | 標準 | LIFF 表單 + LINE chat 建立 + PDF + 轉銷貨單 | quotation.service/.router |
| sales | 銷貨單 | 標準 | LINE chat 建立 + PDF + 成交價驗證 + 售價快照 | sales-order.service/.router |
| sales | 業績獎金 | 標準 | 月結獎金 = (成交價-售價) x 數量 + 代開發票扣 % | commission.service/.router |
| purchase | 進貨單 | 標準 | LINE chat 建立 + PDF + 進價快照 | purchase-order.service/.router |

## 會計模組

| key | 模組名 | 類型 | 說明 |
|-----|-------|------|------|
| accounting | 應收帳款 | 標準 | AR + 月結 N 天 + 到期提醒 + 結案 |
| accounting | 應付帳款 | 標準 | AP + 月結 + 結案 |
| accounting | 電子發票 | 選配 | MIG 4.1 XML + Turnkey + 字軌配號 + 證明聯 PDF + 折讓 |
| accounting | 費用管理 | 選配 | 公務支出 + 憑證 + 分類 |
| accounting | 總帳 / 分錄 | 選配 | 科目表 (CoA) + 手動/自動分錄 + 試算表 |
| accounting | 會計期別 | 選配 | 開/關帳期 |
| accounting | 報表 | 選配 | 損益表 / 資產負債表 / 現金流量表（部分開發中） |

## 庫存模組

| key | 模組名 | 類型 | 說明 |
|-----|-------|------|------|
| inventory | 庫存 | 選配 | 進銷存連動 + 即時庫存查詢 + event-driven 自動更新 |

## 工作日誌

| key | 模組名 | 類型 | 說明 |
|-----|-------|------|------|
| (core) | 工作日誌 | 標準 | 業務拜訪紀錄 / 工作回報 + LINE chat + 後台 |

## LINE Bot 功能

| 功能 | 類型 | 說明 |
|------|------|------|
| Rich Menu | 標準 | 6 格：報價/銷貨/進貨/帳務/查詢/報價追蹤 |
| 產品 Flex 搜尋 | 標準 | 輸入關鍵字 -> Flex Carousel 卡片（含歷史價格） |
| 語音開單 | 選配 | Whisper 語音辨識 + Claude Haiku 指令解析 |
| 名片 OCR | 選配 | Google Vision 名片辨識 -> 新增客戶 |
| 員工綁定 | 標準 | 綁定碼機制（LINE chat / CLI / 後台） |

## 排程 / Jobs

| Job | 類型 | 說明 |
|-----|------|------|
| 逾期帳款提醒 | 標準 | 每日檢查 AR/AP 到期 |
| 月結對帳單 | 標準 | 月初產生 |
| 每日備份 | 標準 | DB dump + email |
| 電子發票同步 | 選配 | Turnkey outbound reader + 漏傳重送 |
| 版本自動升級 | 標準 | daily 10:00 + CP release poll |
| 計費自動續約 | 標準 | daily billing renewal |
| 逾期計費檢查 | 標準 | daily overdue billing check |

## 後台 Admin

| 檢視 | 類型 | 說明 |
|------|------|------|
| 總覽 Dashboard | 標準 | 今日銷貨/進貨 + 逾期帳款 |
| 客戶 / 產品 / 供應商 / 員工 | 標準 | CRUD + 搜尋 + 停用 |
| 報價單 / 銷貨單 / 進貨單 | 標準 | 唯讀列表（建單走 LIFF / LINE chat） |
| 應收 / 應付 | 標準 | 結案 + 發票號碼 |
| 庫存 | 選配 | 即時庫存快照 |
| 電子發票 | 選配 | 列表 / 開立 / 作廢 / PDF / XML |
| 發票配號 | 選配 | 手動建立 / CSV 匯入 / 啟停用 |
| 業績獎金 | 標準 | 月結報表 + 代開發票扣 % |
| 工作日誌 | 標準 | 業務拜訪紀錄列表 |
| Tenant 設定 | 標準 | 公司資料 / 電子發票設定 / 發票章上傳 |
| 操作手冊 | 標準 | Markdown 渲染 + 版號自動注入 |

## 行業擴充模組（客製，需 7-agent 工廠開發）

> 以下模組在特定行業 `_templates/` 裡出現，尚未有通用程式碼。
> 標「客製」表示需要用 feature-factory 工廠走 7-agent 流程開發。

| 模組名 | 出現行業 | 工作量 | 說明 |
|--------|---------|--------|------|
| vehicle-mgmt | 資源回收業 | Epic | 車籍 + 維修 + 輪胎 + 加油費 |
| dispatch | 資源回收業 | Story | 派工單 + 路線 |
| fuel-import | 資源回收業 | Story | 油商 Excel 匯入（多格式偵測） |
| monthly-report | 資源回收業 | Story | 月/季/年報彙整 + PDF |
| waste-manifest | 資源回收業 | Epic | 廢棄物聯單 + 環保署 API |
| vehicle-kpi | 資源回收業 | Quick | 車輛 KPI 看板（維修費/里程） |
| annual-report | 資源回收業 | Quick | 年報彙整（已有月報基礎） |
| env-compliance | 資源回收業 | Epic | 環保法規合規 + 申報 |
| metal-grading | 金屬加工業 | Story | 金屬等級分類 + 成分規格 |
| processing-order | 金屬加工業 | Story | 加工工單 + 工序追蹤 |
| scrap-tracking | 金屬加工業 | Quick | 廢料追蹤 + 回收率 |
| equipment-rental | 機械販售租賃業 | Epic | 設備租賃 + 合約 + 租金計算 |
| maintenance-schedule | 機械販售租賃業 | Story | 定期保養排程 + LINE 提醒 |
| equipment-location | 機械販售租賃業 | Story | 設備位置追蹤 |

### 工作量說明

| 等級 | 估計 | 範圍 |
|------|------|------|
| Quick | < 1 天 | 一個 service + router + 前端 view |
| Story | 1-3 天 | 多檔 + LINE handler + 前端 |
| Epic | 1-2 週 | 新 schema + 多 service + 匯入匯出 + 法規整合 |
