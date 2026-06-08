# Industry Template Init

> 新行業客戶 -> 分析需求 -> 推薦模組 -> 產出行業模板三檔。

## Trigger

業務提供客戶聊天紀錄 + 行業名稱，觸發 `template-init` skill。

## Scope

1. industry-analyst agent 讀 module-library.md + 現有 _templates/ 作參考
2. 分析聊天紀錄萃取需求訊號
3. 推薦標準/選配/客製模組（附理由 + 工作量）
4. **審核點**：使用者確認模組清單
5. 產出 `_templates/<行業>/` 三檔（modules.json / README.md / onboarding-checklist.md）

## Acceptance

| # | 條件 |
|---|------|
| 1 | modules.json standard_modules 的 key 全在 module-keys.md 裡 |
| 2 | README.md 含行業核心流程（觸發/系統/驗收） |
| 3 | onboarding-checklist.md 含 Phase 1-4 + 客戶資料清單 |
| 4 | 格式與現有 _templates/資源回收業/ 一致 |
| 5 | 客製模組有 Quick/Story/Epic 工作量標注 |
| 6 | 審核點正常暫停等使用者確認 |

## Out of scope

- 不自動開發客製模組（只推薦 + 估工作量）
- 不修改 ERP src/ 程式碼
- 不部署或設定 Tenant
