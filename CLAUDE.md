# CLAUDE.md

午餐小鎮：公司內部多人點陣訂餐平台。React + Vite 前端，同一份訂餐領域邏輯跑在兩種環境：Node（Fastify、`node:sqlite`、Socket.IO）與 Sites（Cloudflare Worker、sql.js、D1、短輪詢）。

- 啟動、建置、部署：[README.md](README.md)
- 架構、資料流、常見修改步驟：[docs/development.md](docs/development.md)，動手前先讀
- 分支、commit、PR 與合併流程：[docs/git-flow.md](docs/git-flow.md)

## Git

- 從最新 `origin/main` 開分支，命名 `<類型>/issue-<編號>-<簡述>`；不直接推送或 force push `main`。
- Commit 用 Conventional Commits 前綴，描述用繁中（例：`feat: 分開店家入口與一般使用者入口`）。
- PR 目標 `main`，描述含目的、`## 變更`、`## 驗證`（沒跑的檢查也要寫），完整完成用 `Closes #N`，部分完成用 `Refs #N`。
- 沒有 CI：開 PR 前自己跑 `npm run typecheck`、`npm test`、`npm run build`。

## 指令

```sh
npm ci --ignore-scripts --no-audit --no-fund   # 需要 Node 26（使用 node:sqlite）
npm run typecheck
npm test                                       # Vitest，server/test/
npm run build                                  # Sites 建置；也會驗證 Worker 打包
HOST=127.0.0.1 SEED_FILE=shared/catalog/seed.json DEMO_KEY= npm run dev
```

改完程式至少跑 `npm run typecheck` 與 `npm test`；動到 `server/`、`worker/` 或 `shared/` 時再跑 `npm run build`。

## 必須遵守的架構限制

- **路由只有一份**：`server/routes.ts` 同時給 Fastify 與 Worker（`worker/router.ts`）使用。handler 只能用 `req.sid`、`req.body`、`req.params`、`reply.type().send()`；路徑參數只能是 `:name`。
- **資料庫在 Worker 會被替換**：建置時 `server/db.ts` 會換成 `worker/db.ts`（sql.js）。領域模組以相對路徑 `../db` 匯入，只用同步的 `db.prepare().get/all/run` 與 `db.exec`，不可使用 `node:fs`、`node:path` 等 Worker 沒有的 API（`node:crypto` 可用）。
- **業務表 schema 不在 Drizzle**：在 `server/db.ts` 的 `SCHEMA` 與 `migrate*`。`db/schema.ts`／`drizzle/` 只管 D1 外層的 `app_state`、`live_presence`。Worker 不會執行 `migrateDelivery`／`migratePayment`，新表或新欄位要寫成可重複執行的遷移，並讓 `worker/db.ts` 的 `openSnapshot` 也呼叫（照 `server/store-hours-schema.ts` 或 `server/rooms/social-schema.ts` 的模式），否則已部署的 D1 image 拿不到。
- **即時通道是兩套**：Node 在 `server/realtime/realtime.ts`，Sites 在 `worker/index.ts` 的 `synchronize` 與 `web/adapters/sites-live.ts`。新增即時事件兩邊都要處理。
- **寫入規則**：改動團單的寫入包在 `withWriteTx`，成功後 `bumpRevision`，提交後才呼叫 `ctx.events`。可能重送的寫入帶 `requestId` 並寫入 `processed_requests` 去重；去重檢查排在收單檢查之前。
- **錯誤**：領域模組用 `err.*`（`server/db-shared.ts`）；`shared/` 的純函式不得依賴 server，改拋帶 `code: "INVALID_INPUT"` 的 Error。API 錯誤回 `{ code, message }`，`message` 為繁中使用者文字。
- **前端路由兩處登記**：新增頁面路徑時，`web/main.tsx` 與 `worker/assets.ts` 的 `servePageOrAsset` 都要加，否則 Sites 上直接開啟該網址會失敗。
- **前端**：API 呼叫只經過 `web/adapters/http.ts` 的 gateway，元件不直接 `fetch`。即時同步依 `import.meta.env.VITE_SITES` 切換。

## 慣例

- 型別契約以 `shared/contracts.ts` 為準。`docs/archive/`（舊 `contracts.ts`、`development-spec.md`、`PLAN.md`、`full-version-plan.md`、`lunch-town-handoff.html` 等）是歷史規格，不要修改，也不要當成目前決策。`docs/records/` 是各功能當時的交接與驗證紀錄，現況以程式與 issue 為準。文件索引見 [docs/README.md](docs/README.md)。
- 程式註解、UI 文字、錯誤訊息、文件與 commit message 使用繁體中文。
- 金額一律為整數新台幣；座標對外一律正規化為 0..1（換算見 `shared/town.ts`）。
- 像素素材全部以程式繪製（`web/art/`），不要引入外部圖檔或第三方遊戲素材。
- 測試與本機開發用虛構種子 `shared/catalog/seed.json`；`stores.taichung.json` 是真實店家。
- 瀏覽器與 Sites 測試腳本只對 localhost 執行，並使用獨立的 `DATA_DIR` 或本機 D1，不要刪除既有 `data/`。
- 工作範圍與決策以 [GitHub issues](https://github.com/j10181996/my-lunch-town/issues) 為準；登入（#38）、店家邀請（#21）、同步（#39）等尚未完成，管理碼與 `DEMO_KEY` 只是展示用授權。
