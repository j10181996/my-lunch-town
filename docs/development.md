# 開發指南

午餐小鎮的同一份訂餐領域邏輯要跑在兩種執行環境：本機開發用的 Node（Fastify、`node:sqlite`、Socket.IO），以及 Sites 部署用的 Cloudflare Worker（sql.js、D1、短輪詢）。這份文件說明程式怎麼分層、兩種環境如何共用程式碼，以及修改時哪些地方必須兩邊一起改。

啟動、建置、部署指令與資料保存方式見 [README](../README.md)；分支、commit 與 PR 流程見 [Git 流程](git-flow.md)。這裡不重複。

## 目錄分層

程式分成四塊，依賴方向是單向的：`web` 與 `server` 都依賴 `shared`，`worker` 重用 `server`，`shared` 不依賴任何一方。

```text
shared/   前後端共用：型別契約、計價、外送、收款驗證、營業時間、街區常數、表情清單（純函式）
server/   訂餐領域邏輯與 Node 執行環境（Fastify 路由、node:sqlite、Socket.IO）
worker/   Sites 執行環境：把 server/ 的路由與領域模組包進 Worker，改用 sql.js + D1
web/      React 前端：頁面、遊戲畫面（Canvas）、原創像素素材、API 轉接層
db/       D1 外層表格的 Drizzle schema（app_state、live_presence），產生 drizzle/ 遷移
scripts/  建置腳本與本機整合／瀏覽器測試
```

根目錄的 `contracts.ts`、`development-spec.md`、`PLAN.md`、`docs/full-version-plan.md` 與 `lunch-town-handoff.html` 是來源版本的歷史規格，程式不引用它們。型別契約以 `shared/contracts.ts` 為準。

## 一個請求如何流過系統

以團員按下「+1」為例，兩種環境走到同一個領域函式 `changeQuantity`，差別只在外層：

```text
web/state/useRoom.ts ─ roomGateway（web/adapters/http.ts）
  └─ POST /api/rooms/:id/order-delta
       ├─ Node：Fastify（server/app.ts）→ server/routes.ts
       └─ Sites：worker/index.ts → worker/router.ts → server/routes.ts
            └─ server/orders/orders.ts changeQuantity(ctx, sid, roomId, input)
                 └─ withWriteTx：去重 → 驗證 → 寫入 → bumpRevision
            └─ ctx.events.roomChanged(roomId, revision)
                 ├─ Node：Socket.IO 廣播 room:changed，前端重抓 snapshot
                 └─ Sites：no-op；前端下一次 /live 輪詢看到新 revision 後重抓
```

### 共用的部分

`server/routes.ts` 是唯一的路由表。Node 直接把它註冊到 Fastify；Worker 的 `worker/router.ts` 傳入一個只收集 `get/post/...` 呼叫的假 app，再自行比對路徑與參數。因此新增 API 只要改 `server/routes.ts`，兩邊同時生效，但 handler 只能使用 `req.sid`、`req.body`、`req.params` 與 `reply.type().send()`，不能依賴其他 Fastify 功能。

領域模組（`server/rooms`、`server/orders`、`server/stores`）只透過 `Ctx`（`server/context.ts`）取得 `db` 與 `events`，所有讀寫都是同步的 `db.prepare(...).get/all/run` 與 `db.exec`。這個最小介面是兩種環境能共用程式的前提。

### 資料庫替換

`scripts/build-worker.mjs` 用 esbuild 外掛把所有解析到 `server/db.ts` 的 import 換成 `worker/db.ts`。後者以 sql.js 模擬 `node:sqlite` 的同步介面，並從 D1 `app_state` 讀出整個 SQLite image。

由此帶出幾條限制：

- 領域模組要以相對路徑 `../db` 匯入資料庫相關符號，替換才會生效。錯誤類別與交易輔助（`AppError`、`err`、`withWriteTx`、`hashKey`）放在 `server/db-shared.ts`，兩邊共用。
- 領域模組不能用 `node:fs`、`node:path` 等 Worker 沒有的 API。`node:crypto` 例外，Worker 以 `nodejs_compat` 提供，`server/util.ts` 的 `randomId` 依賴它。
- 只能用 `db.prepare` 的 `get`、`all`、`run`（`run` 只回傳 `changes`）與 `db.exec`；其他 `node:sqlite` 功能 sql.js 轉接層沒有實作。

### Sites 的寫入模型

Worker 每個請求都把整個 image 載入 sql.js，執行領域函式後匯出，以 `revision` 做 compare-and-swap 寫回 D1。版本衝突時整筆重跑，最多 8 次，仍失敗則回 `RETRY_LATER`。GET 請求不寫回。image 超過 1,900,000 bytes 會拒絕寫入（D1 單值上限 2 MB）。

角色位置與表情泡泡這類即時資料不進訂單版本：位置存在 D1 的 `live_presence`（10 秒過期），泡泡存在 image 內的 `live_bubbles`（60 秒清除）。`/api/rooms/:id/live` 與 `/api/stores/:id/live` 只存在於 Worker，由 `worker/index.ts` 的 `synchronize` 處理，不在 `server/routes.ts`。

## 領域規則

### 身分與權限

身分是 `lt_sid` HttpOnly Cookie（24 字元），第一次打 `/api/*` 時建立並寫入 `sessions`。目前沒有帳號系統（ChatGPT 登入由 #38 追蹤）。

| 角色 | 如何取得 | 檢查函式 |
| --- | --- | --- |
| 團主 | 建立團時成為 `owner` 成員 | `requireMember` 後檢查 `me.role === "owner"` |
| 團員 | `POST /api/rooms/:id/join` | `requireMember`（`server/rooms/rooms.ts`） |
| 店家 | 開店，或以管理碼 `claimStore` 認領 | `requireOwner`（`server/stores/stores.ts`） |

種子店家的管理碼固定為 `demo-{storeId}`；`DEMO_KEY` 可一次認領所有種子店家。這兩者都只適合展示，正式授權由 #8、#21、#38 處理。

### 交易、版本與去重

會改變團單的寫入都包在 `withWriteTx`（`BEGIN IMMEDIATE`）內，成功後呼叫 `bumpRevision` 遞增 `rooms.revision`，提交後才觸發 `ctx.events`。前端以 revision 判斷是否需要重抓 snapshot；角色移動不遞增 revision。

可能被重送的寫入（開團、+1/-1、開店）帶 `requestId`，結果存在 `processed_requests`，主鍵是 `(scope, actor_id, request_id)`。相同 requestId 回傳上次結果；內容不同則回 `REQUEST_ID_CONFLICT`。去重檢查刻意排在「已收單」檢查之前，讓收單前送出、收單後才重送的請求仍拿到原本的成功結果。前端遇到 `NETWORK` 或 `RETRY_LATER` 會以同一個 requestId 重試（`web/api.ts` 的 `ApiError.retryable`）。

### 菜單凍結

開團時把當下的店家與餐點複製到 `room_stores`、`room_meals`。之後店家改價、下架或刪除餐點不影響進行中的團；團內計價一律讀凍結副本。

### 錯誤格式

API 錯誤一律回 `{ code, message }`，`code` 是 `shared/contracts.ts` 的 `ErrorCode`，`message` 是給使用者看的繁中文字。在領域模組內用 `server/db-shared.ts` 的 `err.*` 工廠拋出；`shared/` 的純函式不能依賴 server，改拋帶 `code: "INVALID_INPUT"` 的一般 Error，再由 API 邊界轉成 `err.invalid`（見 `shared/payment.ts`、`shared/delivery.ts`）。

## 前端

`web/main.tsx` 以自寫的極簡路由（`web/router.ts`）分派頁面：

| 路徑 | 頁面 | 用途 |
| --- | --- | --- |
| `/` | `pages/Home.tsx` | 一般使用者入口：開團、加入 |
| `/r/:roomId` | `pages/RoomPage.tsx` | 團內：遊戲畫面 + 點餐、彙總、收款面板 |
| `/shop`、`/shop/new`、`/shop/:storeId` | `shop-admin/` | 店家入口、開店、後台 |
| `/management/stores` | `management/StoreList.tsx` | 管理者入口：全部店家摘要 |

新增頁面路徑時，除了 `web/main.tsx`，也要把路徑加進 `worker/assets.ts` 的 `servePageOrAsset`。Sites 不依賴 SPA fallback，不在清單上的路徑直接開啟或重新整理會找不到頁面；Node 模式由 `server/app.ts` 的 not-found handler 統一回 `index.html`，不需另外處理。

所有 API 呼叫集中在 `web/adapters/http.ts` 的 `roomGateway` 與 `storeGateway`。即時同步依建置旗標 `VITE_SITES` 切換：未設定時用 Socket.IO，`npm run build` 會設 `VITE_SITES=1`，改走 `web/adapters/sites-live.ts` 的 `/live` 輪詢。元件不應直接呼叫 `fetch` 或 Socket.IO。

團內狀態由 `web/state/useRoom.ts` 管理。snapshot 以伺服器為準，revision 比目前舊的回應直接丟棄；收到 `room:changed` 或輪詢看到較新 revision 時重抓。+1/-1 送出期間記為 pending 並存進 sessionStorage，同一餐點一次只允許一筆；結果未知時保留 pending，重連後以同一個 requestId 重送釐清。

遊戲畫面是 Canvas，邏輯在 `web/game/game.ts`，React 外殼是 `web/game/GameView.tsx`。素材全部以程式繪製（`web/art/`），以邏輯像素繪製後整數倍放大；場景尺寸與座標換算定義在 `shared/town.ts`，對外座標一律正規化為 0..1。`art-preview.html` 可在 Vite 開發伺服器下預覽素材（`http://localhost:5173/art-preview.html`）。

NPC、收藏與換裝（M4）目前只在前端，收藏存在 localStorage；範圍與簡化之處見 [M4 黑客松展示交接](m4-demo-handoff.md)。

## 常見修改

### 新增 API

1. 在對應領域模組寫函式，簽名沿用 `(ctx 或 db, sessionId, ...params, body)`，先做身分檢查，寫入包在 `withWriteTx`。
2. 型別加到 `shared/contracts.ts`。
3. 在 `server/routes.ts` 註冊路由；路徑參數只能是 `:name` 形式（Worker 的比對器只支援這種）。
4. 在 `web/adapters/http.ts` 的 gateway 加上對應方法。
5. 在 `server/test/` 以 `app.inject` 測試；若涉及 Sites 特有行為，補 `scripts/test-sites.mjs`。

### 新增或修改業務表欄位

業務表的 schema 在 `server/db.ts` 的 `SCHEMA` 字串與 `migrate*` 函式，不在 Drizzle。Drizzle 的 `db/schema.ts` 只管 D1 外層的 `app_state` 與 `live_presence`。

Node 的 `openDb` 每次啟動都會跑 `migrateDelivery`、`migratePayment`，但 Worker 的 `openSnapshot` 不會；它只套用 `SOCIAL_SCHEMA`、`PARTY_SCHEMA`、`migrateStoreHours`、`migrateDeadline` 與 `migrateDeliveryAddress`。已部署的 D1 image 是舊版建立的，不會自動得到新欄位；`worker/seed.bin` 只在 D1 尚未初始化時使用。所以：

- 新表或新欄位要寫成可重複執行的遷移（`CREATE TABLE IF NOT EXISTS`、先查 `PRAGMA table_info` 再 `ALTER TABLE`），並確保 `worker/db.ts` 的 `openSnapshot` 也會套用。做法是把遷移獨立成一個檔案，由 `openDb` 與 `openSnapshot` 都呼叫。新表可參考 `server/rooms/social-schema.ts`（一份 `CREATE TABLE IF NOT EXISTS` 常數）；新欄位可參考 `server/store-hours-schema.ts` 的 `migrateStoreHours`（先查 `PRAGMA table_info`，缺欄才在交易內 `ALTER TABLE`）。Worker 下一筆成功寫入時，升級後的 image 會隨交易一起寫回 D1。
- 遷移不得覆蓋或回填既有資料，除非有明確需求。

### 新增即時事件

Node 與 Sites 的即時通道是兩套實作：Node 在 `server/realtime/realtime.ts`（Socket.IO），Sites 在 `worker/index.ts` 的 `synchronize` 與 `web/adapters/sites-live.ts`。新增事件時兩邊都要做，並在 `RoomEvents`（`server/context.ts`）加上方法；Worker 端若不需推送可留 no-op，靠輪詢補上。

### 店家種子

`shared/catalog/seed.json` 是規格附的虛構店家，測試與本機開發使用。`shared/catalog/stores.taichung.json` 是真實台中店家，Node 未指定 `SEED_FILE` 時的預設值，也是 `worker/seed.bin` 的來源。種子只在資料庫沒有店家時寫入。

## 測試

| 指令 | 內容 | 需要 |
| --- | --- | --- |
| `npm run typecheck` | `tsc --noEmit`，涵蓋 shared、server、web、worker | — |
| `npm test` | Vitest：`server/test/` 以 `openDb(":memory:", SAMPLE_SEED)` 與 `app.inject` 跑 API；`worker/assets.test.ts` 驗證 Sites 頁面路由 | — |
| `npm run build` | Sites 建置，同時驗證 Worker 打包與 sql.js 修補 | — |
| `scripts/test-sites.mjs` | 對本機 Wrangler 跑多使用者 API 流程 | 本機 Worker |
| `scripts/smoke.mjs` | 三個瀏覽器工作階段：開店、開團、點餐、收單、接單、收款 | Node 建置版 + Chrome |
| `scripts/smoke-m4.mjs` | 雙瀏覽器：表情、NPC、收藏、換裝、點餐 | 開發伺服器 + Chrome |
| `scripts/smoke-mobile.mjs` | 手機尺寸與真觸控事件：搖桿走路、觸控點餐、面板收合 | 開發伺服器 + Chrome |

`server/test/` 各檔範圍：`api.test.ts` 是團單、計價、去重、收單與店家訂單主流程；`delivery.test.ts` 是外送規則與距離；`payment.test.ts` 是人工收款狀態與隱私；`social.test.ts` 是表情頻率與社交開關；`shopkeeper.test.ts` 是店內店主台詞的情境與輪替；`store-hours.test.ts` 是台灣時區的營業時段、截止時間與開團篩選；`store-list.test.ts` 是管理者店家清單的公開欄位與權限。

瀏覽器與 Sites 腳本只允許對 `localhost`／`127.0.0.1` 執行，並會寫入測試資料，請用獨立的 `DATA_DIR` 或本機 D1。
