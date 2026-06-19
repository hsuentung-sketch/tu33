# Announcement Module (公告模組)

## Trigger

- ADMIN 在後台新增公告 → 存 DB + 可選 LINE 推播給該 tenant 所有已綁定員工

## Scope

1. ADMIN 可建立 / 編輯 / 刪除公告
2. 所有角色登入後台 Dashboard 看到未過期公告（最新在上）
3. 建立公告時可選「推播至 LINE」→ 呼叫現有 LINE push 框架

## Data Model

```
Announcement
  id            String   @id @default(cuid())
  tenantId      String
  title         String
  content       String   @db.Text
  priority      String   @default("normal")   // "normal" | "important" | "urgent"
  isPublished   Boolean  @default(true)
  publishedAt   DateTime @default(now())
  expiresAt     DateTime?
  createdBy     String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
```

## API

- `GET    /api/announcements`        — list (active, not expired, sorted by publishedAt desc)
- `GET    /api/announcements/:id`    — get one
- `POST   /api/announcements`        — create (ADMIN only); body includes `pushToLine: boolean`
- `PUT    /api/announcements/:id`    — update (ADMIN only)
- `DELETE /api/announcements/:id`    — soft-delete / hard-delete (ADMIN only)

## Admin UI

- Dashboard 頂部：未過期公告 banner（urgent = 紅底, important = 黃底, normal = 藍底）
- 管理頁面（`#management/announcements`）：CRUD 列表 + 新增 modal

## LINE Push

建立公告 + pushToLine = true → 用現有 `lineClient.pushMessage` 推文字訊息給該 tenant 全部有 lineUserId 的 employee。

## Acceptance

- [ ] ADMIN 可在後台 CRUD 公告
- [ ] 所有角色 Dashboard 可見未過期公告
- [ ] 勾選 LINE 推播可推送
- [ ] 非 ADMIN 不能建立/編輯/刪除

## Out of scope

- 富文本編輯器（純文字即可）
- 公告讀取追蹤（誰看過）
- 公告分類 / 標籤
- 公告附件
