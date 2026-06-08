# License + Release Poll Client (F.3)

> ERP instance 端的 CP 連線：license 驗證 middleware + release manifest 輪詢。

## Trigger

- **License middleware**: 每個 `/api/*` request 觸發（結果 1h cache）
- **Release poll**: daily cron 10:00 Asia/Taipei（與 auto-upgrade 同排程）

## Scope

### License Middleware

1. 讀 `process.env.LICENSE_KEY`，未設 -> 全部放行（dev 模式）
2. 呼叫 CP `GET /api/platform/license/verify?licenseKey=xxx`（5s timeout）
3. 結果 cache 1 小時，避免每個 request 都打 CP
4. 離線容錯：CP 掛了但上次有效 check < 24h -> 仍視為有效
5. `valid=true` -> next()
6. `inGracePeriod=true` -> next() + `X-License-Grace: true` header
7. `valid=false` + GET/HEAD/OPTIONS -> next()（readonly mode）+ `X-License-Expired: true`
8. `valid=false` + POST/PUT/PATCH/DELETE -> 403 `LICENSE_EXPIRED`

### Release Manifest Poll

1. 讀 `process.env.CP_BASE_URL`，未設 -> skip
2. Fetch `GET {CP_BASE_URL}/api/platform/releases/latest`
3. 若有 `RELEASE_SIGNING_KEY` -> HMAC-SHA256 驗簽
4. 比對 `manifest.commit` vs 本機 `GIT_COMMIT` / `FLY_MACHINE_VERSION`
5. 有新版 -> log（未來可接 LINE push 通知 operator）

## Acceptance

| # | 條件 | 驗證 |
|---|------|------|
| 1 | `LICENSE_KEY` 未設 -> middleware 不擋任何 request | 本機啟動測試 |
| 2 | `valid=false` -> POST 被 403、GET 正常 | 設假 key + mock CP |
| 3 | `inGracePeriod=true` -> 全通 + X-License-Grace header | 同上 |
| 4 | CP 掛了 + 上次有效 < 24h -> 不鎖 | 斷網測試 |
| 5 | CP 掛了 + 超過 24h -> 鎖 mutation | 改 lastValidAt 測試 |
| 6 | LINE webhook route 不受影響（掛在 middleware 之前） | 確認 mount 順序 |
| 7 | release poll 有/無 CP_BASE_URL 都不 crash | 看 log |
| 8 | signature mismatch -> log error, 不 crash | 設錯 key 測試 |

## Out of Scope

- 不自動 deploy 新版（只 log + 未來通知）
- 不存 license 狀態到 DB（純 memory cache）
- 不做 per-tenant license（整個 instance 一把 key）
- 不改 LINE webhook / PDF download 的存取邏輯

## 受影響檔案

| 路徑 | 變更 |
|------|------|
| `.env.template` | +3 env vars |
| `src/config/index.ts` | +controlPlane section |
| `src/shared/license-check.ts` | **新檔** |
| `src/shared/license-middleware.ts` | **新檔** |
| `src/jobs/daily-version-auto-upgrade.ts` | +Part A release poll |
| `src/index.ts` | mount licenseMiddleware |
