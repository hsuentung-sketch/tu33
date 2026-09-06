# 檢測報告佐證資料收集 checklist

送審前必收集，共 3 大類 ~50 個檔案。用途：報告 README.md 各處 `<!-- TODO -->` 標記引用。

---

## A. Phase A 系統面截圖 ✓ 已完成 (2026-09-06)

- [x] `phase-a/A1-A2-pool-and-duplicate-check.jpg` — 字軌配號池 (A1) + 重號檢核 (A2) + 7 天狀態
- [x] `phase-a/A3-A4-recon-and-alert.jpg` — 每日對帳 (A3) + 告警訊息 (A4)
- [x] `phase-a/A-verify-cli.txt` — verify-phase-a CLI 輸出（補充佐證）

---

## B.0 EINV 平台匯出 Excel ✓ 已完成 (2026-09-06)

第三方原始資料，比截圖更有力：

- [x] `phase-b/einv-export-all-issued.xlsx` — 23 張 F0401 開立已確認
- [x] `phase-b/einv-export-void-1150708.xlsx` — JZ50075670 作廢已確認 (F0501)
- [x] `phase-b/einv-export-nullify-1150708.xlsx` — JZ50075672 已註銷 (F0701)
- [x] `phase-b/einv-export-allowance-1150708.xlsx` — AL20260816005 折讓已確認 (G0401)
- [x] `phase-b/einv-export-allowance-1150910.xlsx` — AL20260906001 作廢已確認 (G0401 + G0501 端到端)

**5 份 EINV 官方 Excel 已完整涵蓋 6 類 MIG 訊息（F0401/F0501/F0701/G0401/G0501/E0402）。**
E0402 空白字軌回報為排程自動執行，無需 EINV 平台查詢。

## B. Phase B 24 筆佐證（18 情境 + 6 修正驗證）

### B.1 XML 檔案（24 份）

到潤樋後台「發票列表」→ 每張點 XML 連結下載，命名格式：
`phase-b/xml/<情境代號>-<發票號>.xml`

- [ ] B01 JZ50075655（F0401 開立 + F0701 註銷 2 份）
- [ ] B02 JZ50075656
- [ ] B03 JZ50075657
- [ ] B04 JZ50075658
- [ ] B05 JZ50075659
- [ ] B06 JZ50075660
- [ ] B07 JZ50075661（F0401 開立 + F0501 作廢 2 份）
- [ ] B08 JZ50075662（F0401 開立 + G0401 折讓 2 份）
- [ ] B09 JZ50075663（F0401 開立 + G0401 全額折讓 + G0501 作廢折讓 3 份）
- [ ] B15 JZ50075664
- [ ] B16 JZ50075665
- [ ] B17 JZ50075666
- [ ] B18 JZ50075667
- [ ] V01-V05 JZ50075669~50075673 + AL20260816001~005（G0401 5 組）
- [ ] V06 JZ50075674 + AL20260816006（G0501）

**替代方案（快速）**：從 Linode `/opt/turnkey/app/linux/EINVTurnkey/UpCast/B2SSTORAGE/F0401/BAK/YYYYMMDD/HH/` 打包下載，一次搞定。

### B.2 EINV 平台截圖（18 張）

到 https://wwwtest.einvoice.nat.gov.tw 營業人功能 → 銷項發票查詢：

- 期別 `115/07-08` 查詢
- 每張截圖存 `phase-b/einv-screenshots/<情境代號>-<發票號>.png`

---

## C. Phase C 壓測佐證（若跑完）

- [ ] `phase-c/einvoice-pressure-test-YYYYMMDD-HHMM.md` — 工具輸出報告
- [ ] `phase-c/C-linode-upcast.txt` — Linode 收檔張數
  ```bash
  ssh runtong@172.104.74.184 "ls /opt/turnkey/app/linux/EINVTurnkey/UpCast/B2SSTORAGE/F0401/BAK/20260901/ | wc -l" > phase-c/C-linode-upcast.txt
  ```
- [ ] `phase-c/C-linode-sendfile.txt` — Linode SendFile 送出張數
  ```bash
  ssh runtong@172.104.74.184 "ls /opt/turnkey/app/linux/EINVTurnkey/SendFile/BAK/20260901/ | wc -l" > phase-c/C-linode-sendfile.txt
  ```
- [ ] `phase-c/C-einv-recon.png` — EINV 平台銷項查詢期別 115/09-10 顯示總張數

---

## D. 穩定性佐證 ✓ 已完成 (2026-09-06)

- [x] `phase-d/D1-systemd-turnkey.png` — Turnkey daemon 常駐 4 天 active running，systemd enable 開機自動起
- [x] `phase-d/D2-linode-crontab.png` — rclone R2 sync 兩條 `*/5 * * * *` 排程
- [x] `phase-d/D3-recon-alert.jpg` — 對帳結果 + 告警訊息（同 Phase A 儀表板 A3+A4，複用）

---

## 送審前最後檢查

- [ ] README.md 所有 `<!-- TODO -->` 都填了
- [ ] 24 份 XML 全部收齊
- [ ] 18 張 EINV 平台截圖收齊
- [ ] 聯絡窗口資訊填寫
- [ ] 若走壓測路線：Phase C 5 個檔案齊全
- [ ] Markdown → 用 pandoc 轉 PDF 或用 anthropic-skills:docx 轉 Word
  ```bash
  # markdown → PDF（需先裝 pandoc + LaTeX）
  pandoc docs/einvoice-cert-report/README.md -o einv-cert-report.pdf --pdf-engine=xelatex -V CJKmainfont="標楷體"
  ```
