# M4 黑客松展示交接

2026-11-07。分支：`codex/m4-town-life-social`。認領範圍：#30、#33、#34、#35、#36，皆標記 `process`。本次先交付可展示的子集，Issue 保留開啟，完整驗收項目未全部完成。

## 已實作與展示順序

1. 兩個獨立瀏覽器開啟同一團。右上角可傳送揮手、愛心、好想吃、慶祝四種表情；頭上泡泡同步給同團玩家。
2. 街區有 2 位村民、4 隻小動物（兩隻貓、一隻狗、一隻鳥），沿安全路點散步、停留與轉頭。靠近後按 Enter，或點畫面下方按鈕聊天／摸摸。店門與商品優先；NPC 不會阻擋玩家，也不會進入店內。
3. 走近發光小物會自動撿起。打開右上角背包可看今日五件收藏與四種成就（進店、成功點餐、摸動物、收藏）。同一天重新整理不會再次生成已撿過的小物。
4. 背包可直接選小花髮飾、葉子帽、午餐小帽與原造型。配件隨四個方向顯示，同團其他人也看得到；已獲得的第一個成就作為名牌徽章，可隱藏。
5. 兩人進同一家店可看到同店名單。背包內可關閉村民動物、社交泡泡、徽章；關閉社交後後端停止發送自己的餐點泡泡及表情。點餐、團主彙總不受影響。

窄街景（小於 600 CSS px）減為 3 位 NPC；背包會在街景範圍內捲動。手機觸控移動仍由 #18 處理。

## 黑客松簡化範圍

- **#33**：成就由前端觀察進店、後端已確認的訂單快照、動物互動與撿拾觸發。尚未實作完整伺服器成就事件、團主／店家成就、跨裝置進度或防重送的持久化事件。
- **#34**：每人每天最多五件；位置依團與成員固定產生，收藏使用 localStorage 保存，範圍為此瀏覽器的此團成員。尚未實作伺服器位置驗證、防作弊或跨裝置背包。沒有金額、折扣或訂單效果。清除網站資料會重置展示收藏。
- **#35**：配件直接開放選用，未串成就／套組解鎖。造型依本機收藏設定保存，透過既有 presence 同步；重新部署前後保留取決於瀏覽器網站 origin 是否相同。
- **#36**：動物為原創 Canvas 像素圖，村民沿用現有角色。路線依團 ID 固定生成，以時間取樣；各端系統時間差會影響位置。玩家靠近時本機停留，偏差限制一格左右，不做伺服器 NPC 同步。
- **#30**：後端限制固定表情清單、成員資格與每秒一次送出；社交偏好在既有資料庫保存。表情與清除事件沿用既有 bubble 管道。社交關閉不會隱藏原本的團單彙總、團主明細或角色位置。

## 與隊友整合／重新部署

本次沒有操作雲端 Site。隊友可取得分支後合併或 cherry-pick，再沿用其既有 Sites 部署流程。

```sh
git fetch origin
git switch --track origin/codex/m4-town-life-social
npm ci
npm run typecheck
npm test
npm run build
```

Node、Sites 共用新增的 `/api/rooms/:id/emote`（POST）與 `/social`（PUT）路由；Sites 仍走現有 HTTP polling，Node 仍走 Socket.IO。

資料新增 `member_social` 表。Node 啟動與 Sites 讀取舊 SQLite 快照時都會以可重複執行的 CREATE TABLE IF NOT EXISTS 補齊；沿用既有 app_state 持久化方式，沒有新 D1 binding 或外部服務。部署須包含前端、共用 API 與 worker 改動，不可只拿前端檔案。若隊友已更換登入／資料庫層，需保留其身分與權限實作並接入這兩個路由。

## 地端驗證

- `npm run typecheck`、`npm test`（93 tests）、`npm run build` 通過。
- `node scripts/smoke-m4.mjs http://127.0.0.1:5178`：Node + Vite 的雙獨立瀏覽器驗證通過。
- `node scripts/smoke-m4.mjs http://127.0.0.1:8799`：Sites 本機 Worker 的雙獨立瀏覽器驗證通過。
- 上述驗證包含跨瀏覽器表情／配件、鍵盤摸摸、自動撿拾、成就、同店名單、社交關閉後點餐與不廣播、重整保存、徽章隱藏及窄螢幕背包捲動；沒有 pageerror。本機窄螢幕 rAF 約 60fps，這不是實體手機效能承諾。
- 原有 `scripts/smoke.mjs` 使用獨立示範種子通過：開店、上架、鍵盤走路進店、Enter 加餐、同步彙總、收單、匯出、接單與付款確認。
- `npm run test:sites`：本機 Worker 的 sessions、權限、訂單去重、6 個並行寫入、presence、泡泡、收單、店家狀態、收款確認通過。

本機 Worker 測試啟動方式（獨立測試資料）：

```sh
npm run build
./node_modules/.bin/wrangler d1 migrations apply lunch-town-local --local --persist-to /tmp/lunch-town-m4-worker
./node_modules/.bin/wrangler dev --ip 127.0.0.1 --port 8799 --persist-to /tmp/lunch-town-m4-worker --local
```

Node 地端：`npm run dev`，前端預設 5173，API 預設 3000。測試腳本只允許 localhost／127.0.0.1，請勿對正式團單執行。

本次環境安裝與清理紀錄見 [local/m4-environment.md](local/m4-environment.md)。
