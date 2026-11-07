# My Lunch Town 午餐小鎮

公司內部的多人點陣訂餐平台。團主分享團網址，團員操控角色逛店、加減餐點，團主彙總收單，店家在後台處理訂單。

目前保留 lunch-town 的 React、Vite、Hono、Socket.IO 與 Node SQLite 開發模式，並已新增 Workers／D1 的 Sites 部署路徑。ChatGPT 登入、內部成員授權與店家邀請制仍由對應 issues 追蹤。

## 本機啟動

基線驗證使用 Node.js 26.0.0 與 npm，資料庫依賴 `node:sqlite`。在專案根目錄執行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
HOST=127.0.0.1 SEED_FILE=shared/catalog/seed.json DEMO_KEY= npm run dev
```

前端預設為 `http://localhost:5173`，API 與 Socket.IO 為 `http://localhost:3000`。Vite 開發伺服器的 `host: true` 會對外監聽，本機執行不代表已具備內部平台的存取限制。

此命令使用虛構店家種子；只有空資料庫才會寫入種子，預設資料夾是 `data/`。如需隔離資料，可設定 `DATA_DIR` 指向另一個目錄，請勿刪除有價值的既有資料來切換種子。

`DEMO_KEY=` 僅停用一次認領所有種子店家的展示入口；固定種子店家管理碼及匿名流程仍存在，須由 #8、#21、#38 處理，不能把目前版本當作可正式上線的授權系統。

## Node 模式建置及執行

```sh
npm run build:node
HOST=127.0.0.1 SEED_FILE=shared/catalog/seed.json DEMO_KEY= npm start
```

開啟 `http://localhost:3000`。這個模式由本機 Node 伺服器供應網頁、API 和 Socket.IO，並非 ChatGPT Sites 部署產物。

## Sites 完整功能部署

本 checkout 新增 Cloudflare Workers + D1 部署路徑，保留原有 Node 開發模式。

- `npm run build`：產生 `dist/client`、`dist/server/index.js`、預編譯 SQLite WASM 與 Sites 遷移 metadata。
- `npm run db:generate`：依 `db/schema.ts` 產生 D1 schema migration。
- 本機 Worker：先 `npx wrangler d1 migrations apply lunch-town-local --local`，再 `npm run preview:sites`（預設 8787；可直接用 Wrangler 指定其他連接埠）。
- `SITES_TEST_URL=http://127.0.0.1:8799 node scripts/test-sites.mjs`：僅限本機的多使用者整合測試。
- 原有 Node：`npm run dev`；Node 正式版請用 `npm run build:node && npm start`。它仍使用原本的 SQLite 與 Socket.IO。

### 資料保存與同步

Sites 使用 SQL.js 執行同一份訂餐領域邏輯，將 SQLite image 存在 D1 `app_state`。每次寫入以 revision compare-and-swap 提交；版本衝突時重跑交易，成功後才回應。原本的 requestId 去重、訂單鎖定、店家權限與付款隱私規則保持一致。API 路由（`server/api.ts`，Hono）由 Node 與 Worker 共用。

此模式適合活動展示與小型團購；每次交易需讀寫完整 image，並非大型服務的逐表 D1 模型。為遵守 D1 單值 2 MB 限制，image 上限設為 1,900,000 bytes，超過時會拒絕本次寫入並保留既有資料；長期或大量使用應改用分片 image 或逐表交易模型。業務表位於 image 內，Sites 的 D1 表格檢視器僅會顯示 envelope 與在線位置。初始 image 使用 `shared/catalog/stores.taichung.json`，只在 D1 尚未初始化時載入，重新部署不會覆蓋資料。

Sites 前端以短輪詢取代 Socket.IO：房間每次完成回應後約 250ms 再同步，店家每秒檢查更新；實際延遲另加網路時間。斷線會顯示離線並自動重試。角色在線資訊存於 D1 `live_presence`，以分頁識別碼區分連線，10 秒未更新即不再顯示；位置不影響訂單版本。伺服器從 Cookie 推導角色身分，重新核對房間與店家權限。

工作階段使用 Secure、HttpOnly、SameSite=Lax Cookie。同一瀏覽器會沿用原有身分；跨瀏覽器須重新加入，店家可使用管理碼找回。`DEMO_KEY` 預設為 `demo`，空字串可停用展示用種子店認領；正式公開營運前請自行設定管理方式。收款功能維持原本的人工回報／確認，沒有串接或執行金流。

新增 Site 預設為私人；部署不會自動開放任何持有網址者存取。

## 測試

```sh
npm run typecheck
npm test
npm run build
```

既有測試位於 `server/test/`，涵蓋團單、計價、去重、收單、店家訂單、外送規則與人工收款狀態。

店家照片上傳、32×32 點陣轉換、Node／R2 圖片保存與測試方式見 [自訂餐點圖片](docs/custom-meal-images.md)。Sites 部署須提供 R2 `BUCKET` binding。

`scripts/smoke.mjs` 是既有多瀏覽器流程測試，需要本機 Google Chrome。先以新的隔離資料目錄和 `shared/catalog/seed.json` 啟動建置版本，再執行：

```sh
node scripts/smoke.mjs http://localhost:3000 smoke-shots
```

測試會建立店家、團單及示範收款資料，請使用專用測試資料庫。CI 的瀏覽器與身分測試由 #7 後續調整。

## 後續工作與來源

目前決策與工作範圍以 [GitHub issues](https://github.com/j10181996/my-lunch-town/issues) 為準：#2 驗證 Sites、#5 遷移後端、#13 資料庫遷移、#38 登入與內部授權、#21 店家邀請、#39 同步、#40 畫面沿用。

- [開發指南](docs/development.md)：架構分層、Node／Sites 共用方式與常見修改步驟
- [Git 流程](docs/git-flow.md)：分支命名、commit、PR 描述與合併方式
- [文件索引](docs/README.md)：目前有效的指南、功能交接與驗證紀錄（`docs/records/`）、歷史規格（`docs/archive/`）
- [來源基線與驗證紀錄](docs/records/baseline.md)
- `docs/archive/` 保留來源版本的規格、規劃書、提案範本與 `lunch-town-handoff.html`，作為歷史規格與視覺參考，其中舊架構或帳號方案不代表目前決策。
- `docs/archive/assets/`（原始規格的參考圖）與 `web/art/` 保留視覺素材。使用者已於 2026-11-07 確認程式碼、素材及真實店家菜單可公開；目前未指定開源授權條款。

### M3：營業時間與接單截止（#22）

店家後台可啟用七天營業時段，每天最多三段；空白日為公休，結束早於開始表示跨午夜，區間為含開始、不含結束。時段以台灣 UTC+8 計算，不依賴伺服器或瀏覽器時區；跨日重疊會被拒絕。未設定時保留手動營業模式，手動休息優先於週時段。

開團時伺服器排除非營業時段的店家及餐點，並固定當團的價格與截止時間。店家後續改時段不影響既有團。每日截止時間為選填；跨午夜營業時，早於開始時間的截止點屬於隔天。團主收單前，若有點餐店家已過截止時間，會顯示提醒；仍可確認送出，不自動取消訂單或拒絕收單。

SQLite 領域 image 的相容升級在 `server/store-hours-schema.ts`，新增 nullable 的 `stores.hours_json` 與 `room_stores.order_deadline_at`，不重設舊資料。Node 啟動與 Worker 開啟 image 時共用這份冪等升級；Worker 的下一筆成功寫入會將升級後 image 與交易一起以 D1 revision 檢查提交。D1 envelope schema 不變。

### 管理者入口與店家清單（#21 的清單部分）

依使用者決策，先提供管理入口，平台角色及權限設計另行處理。首頁「管理者入口」前往 `/management/stores`，列出全部店家的公開摘要，提供搜尋、接單狀態篩選及進入既有店家後台的連結。

`GET /api/management/stores` 的全店摘要僅含店名、類型、位置及接單狀態；菜單數量、進行中團數與詳細營業設定仍只提供給原本有權管理的 session。所有管理連結沿用原後台的權限檢查，不會因為能看到清單就自動取得編輯權限、認領店家或改寫管理者。API 不輸出 session、管理碼或其雜湊。

此改動尚未完成 #21 的平台角色、邀請／接受／撤銷、多位管理者及 #38 的內部成員授權；未設定任何初始平台管理者。
