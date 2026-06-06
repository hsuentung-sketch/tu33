# 潤樋 — 偏離模板差異記錄

> 潤樋為 saas-erp-main 的第一個 tenant，本身即為金屬加工業的功能參考基準。
> 多數功能在此開發驗證後才萃取為行業模板或共用模組。

## 目前已知偏差

| 項目 | 標準行為 | 潤樋實際行為 | 原因 |
|------|---------|------------|------|
| 名片 OCR | 可選模組 | 預設開啟 | 客戶主動需求，已實裝 |
| 語音指令解析 | 可選模組 | 預設開啟（Claude Haiku）| 客戶主動需求，已實裝 |
| 報價單 LIFF | 核心流程 | 使用 LIFF ID `2009797959-uDVN0eGQ` | 潤樋專屬 LINE Login Channel |

## 注意事項

- `settings.lineLoginChannelId` 用於 LIFF token → tenant 查找，每個 tenant 必須各自設定
- 潤樋無 `multiCompanyMode`（單公司）
- 若其他 tenant 要 OCR/語音，需在其 settings.json 的 features 手動開啟
