# My Lunch Town 午餐小鎮

公司內部的多人點陣訂餐平台。團主分享團網址，團員操控角色逛店、加減餐點，團主彙總收單，店家在後台處理訂單。

目前保留 lunch-town 的 React、Vite、Fastify、Socket.IO 與 Node SQLite 開發模式，並提供 Workers／D1 的 Sites 部署路徑。Sites 使用 ChatGPT 登入、明確的內部 allowlist，以及店家邀請制。

## 本機啟動

基線驗證使用 Node.js 26.0.0 與 npm，資料庫依賴 `node:sqlite`。在專案根目錄執行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
HOST=127.0.0.1 SEED_FILE=shared/catalog/seed.json DEMO_KEY= npm run dev
```

前端預設為 `http://localhost:5173`，API 與 Socket.IO 為 `http://localhost:3000`。Vite 開發伺服器的 `host: true` 會對外監聽，本機執行不代表已具備內部平台的存取限制。

此命令使用虛構店家種子；只有空資料庫才會寫入種子，預設資料夾是 `data/`。如需隔離資料，可設定 `DATA_DIR` 指向另一個目錄，請勿刪除有價值的既有資料來切換種子。

`DEMO_KEY=` 僅影響本機展示模式的一次認領入口。固定種子店家管理碼和匿名流程只為既有本機測試保留，不能用來驗證 Sites 的正式權限設計。

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

Sites 使用 SQL.js 執行同一份訂餐領域邏輯，將 SQLite image 存在 D1 `app_state`。每次寫入以 revision compare-and-swap 提交；版本衝突時重跑交易，成功後才回應。原本的 requestId 去重、訂單鎖定、店家權限與付款隱私規則保持一致。既有 `server/routes.ts` 由 Fastify 與 Worker 共用。

此模式適合活動展示與小型團購；每次交易需讀寫完整 image，並非大型服務的逐表 D1 模型。為遵守 D1 單值 2 MB 限制，image 上限設為 1,900,000 bytes，超過時會拒絕本次寫入並保留既有資料；長期或大量使用應改用分片 image 或逐表交易模型。業務表位於 image 內，Sites 的 D1 表格檢視器僅會顯示 envelope 與在線位置。初始 image 使用 `shared/catalog/stores.taichung.json`，只在 D1 尚未初始化時載入，重新部署不會覆蓋資料。

Sites 前端以短輪詢取代 Socket.IO：房間每次完成回應後約 250ms 再同步，店家每秒檢查更新；實際延遲另加網路時間。斷線會顯示離線並自動重試。角色在線資訊存於 D1 `live_presence`，以分頁識別碼區分連線，10 秒未更新即不再顯示；位置不影響訂單版本。伺服器從 ChatGPT Sites 注入的穩定使用者 ID 推導身分，重新核對內部成員、房間與店家權限；不信任或延續 `lt_sid` Cookie。

ChatGPT 的相同使用者跨瀏覽器會得到同一個領域身分。內部使用者需由 `LUNCH_MEMBER_IDS`／`LUNCH_ADMIN_IDS` 明確允許；店家由管理員發出一次性邀請連結取得個別店家的後台。設定、權限表與操作流程見 [ChatGPT 登入與店家邀請](docs/chatgpt-auth.md)。收款功能維持原本的人工回報／確認，沒有串接或執行金流。

新增 Site 預設為私人；部署不會自動開放任何持有網址者存取。

## 測試

```sh
npm run typecheck
npm test
npm run build
```

既有測試位於 `server/test/`，涵蓋團單、計價、去重、收單、店家訂單、外送規則與人工收款狀態。

`scripts/smoke.mjs` 是既有多瀏覽器流程測試，需要本機 Google Chrome。先以新的隔離資料目錄和 `shared/catalog/seed.json` 啟動建置版本，再執行：

```sh
node scripts/smoke.mjs http://localhost:3000 smoke-shots
```

測試會建立店家、團單及示範收款資料，請使用專用測試資料庫。CI 的瀏覽器與身分測試由 #7 後續調整。

## 後續工作與來源

目前決策與工作範圍以 [GitHub issues](https://github.com/j10181996/my-lunch-town/issues) 為準：#2 驗證 Sites、#5 遷移後端、#13 資料庫遷移、#38 登入與內部授權、#21 店家邀請、#39 同步、#40 畫面沿用。

- [來源基線與驗證紀錄](docs/baseline.md)
- `development-spec.md`、`PLAN.md`、`docs/full-version-plan.md` 與 `lunch-town-handoff.html` 保留來源版本，作為歷史規格與視覺參考，其中舊架構或帳號方案不代表目前決策。
- `assets/` 與 `web/art/` 保留視覺素材。使用者已於 2026-11-07 確認程式碼、素材及真實店家菜單可公開；目前未指定開源授權條款。
