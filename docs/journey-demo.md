# 台中午休小旅行：新手任務與全團合照

對應 Issue #55。黑客松展示功能，未操作雲端部署。

## 展示流程

1. 使用邀請連結加入同一團。左上「新手任務」可展開三站引導：逛一家店、摸摸小動物、選一份午餐。「帶我逛店／點餐」前往第一家有可用餐點的店；找動物會返回街區並開啟動物顯示。
2. 任務沿用現有成就判定，三站完成會變成「午休冒險完成」。任務自由進行，不會限制點餐。新手任務、成就與收藏沿用 localStorage，限此瀏覽器、此團成員，沒有新增伺服器任務帳號進度。
3. 側欄最上方顯示「已有 x／n 人選好午餐」。至少有一份餐點才可按「我選好了」，可隨時取消。手機收合菜單時仍可從收合列看到完成數。
4. 完成狀態以全團已加入成員為分母，包含離線成員。新加入的人會增加分母。修改餐點會取消自己的完成狀態；訂單 requestId 重試不會誤清除，失敗的訂單也不會清除。
5. 最後一位完成時，成員的畫面共同出現彩帶與合照。減少動態效果偏好會關閉彩帶。同一分頁工作階段重新整理不重播；另開分頁可能再呈現最近一次完成，後端不會因此新增慶祝。
6. 合照是完成當下的角色、暱稱與台中午休紀念卡，並非拍攝相機或即時遊戲截圖；不含餐點、金額、付款資料或配件。可下載 PNG，手機可長按儲存。每頁最多 36 人，更多人分頁下載；圖片不會上傳。
7. 最近一次合照保留，可從側欄重開。晚加入者不會自動播放不包含自己的舊合照；再次全團完成會產生新一輪合照。
8. 「選好了」**不會收單、送單或變更付款**，團主仍使用既有確認收單流程。收單後完成狀態唯讀。

## 資料與整合

- 新增 `member_ready`、`room_celebrations`，前者按 member 主鍵記錄完成，後者按 room 保存慶祝序號與最新名單。
- Node 啟動與 Sites 讀取既有 SQLite 快照時補建表；沿用現有 app_state／CAS 寫入流程，無額外 D1 binding 或外部服務。
- 新增 `PUT /api/rooms/:id/lunch-ready`，body 為 `{ ready: boolean }`。後端依現有 session／團員授權操作本人，明確值可冪等重試；只有實際改變狀態才增加 room revision。
- 完成與取消在交易內處理，最後一人確認時保存名單。Node 透過 roomChanged、Sites 透過現有輪詢同步。
- 合併時需帶齊共用型別、前後端與 Worker DB 改動，不可只部署前端。

## 地端驗證

- `npm run typecheck`、`npm test`（143 tests）、`npm run build`（Sites）、`npm run build:node` 通過。
- `node scripts/smoke-journey.mjs http://127.0.0.1:5178 /tmp/lunch-town-55-node-shots`：Node 雙瀏覽器（桌面與觸控手機）驗證三項任務、真實點餐與摸動物、同步完成、PNG 下載、重整、改餐取消、新團員／舊合照、無自動送單及 pageerror。
- 同一腳本在 `http://127.0.0.1:8799` 的 Sites 本機 Worker 通過，另驗證三人同時確認只產生一次慶祝，以及 320／360px 與橫向的任務操作與按鈕無重疊。
- `node scripts/smoke-mobile.mjs http://127.0.0.1:5178 /tmp/lunch-town-55-mobile-regression`：390×844／412×915 觸控模擬、搖桿進店、直接點餐與橫向版面通過。
- 原有 `scripts/smoke.mjs` 桌面流程與 `npm run test:sites` 通過，包含店家接單、收款與並行寫入。
- 尚未執行實體 iPhone Safari／Android Chrome、雲端多真實帳號或部署驗收。

Node 地端以 `PORT=3000 HOST=127.0.0.1 DATA_DIR=/tmp/lunch-town-55-node SEED_FILE=shared/catalog/seed.json npm run dev:server` 與 `npm run dev:web -- --host 127.0.0.1 --port 5178` 啟動。

Sites 地端先 `npm run build`，接著 `wrangler d1 migrations apply lunch-town-local --local --persist-to /tmp/lunch-town-55-worker`，再 `wrangler dev --ip 127.0.0.1 --port 8799 --persist-to /tmp/lunch-town-55-worker --local`。Node build 的 outDir 與 Sites 產物共用 dist；切換正式建置時請依測試目標重建。

## 後續增加台中辨識度的方向

本次已融入「台中午休小旅行」任務文案、綠帶與暖色店面意象、太陽餅造型的合照太陽。下列是後續提案，尚未實作：

- 將收藏小物改成太陽餅、珍奶杯、街景明信片，保留原本走近撿拾的玩法。
- 用草悟道綠帶、第二市場騎樓的視覺意象設計局部街景；保留小鎮比例，不宣稱是真實路線地圖。
- NPC 增加午休散步與台中店家話題；採用經核對的店名與資訊，避免編造推薦或營業時間。
- 合照提供一兩款台中紀念卡邊框，讓觀眾願意保存，沿用現有角色與 PNG 匯出即可。

已整合 main 的飲食標籤／預算提醒與開發指南提交（`e61ac38`），重新完成型別、143 個測試、Sites 建置與新手任務整合驗證。
