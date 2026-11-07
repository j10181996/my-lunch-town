# 午餐小鎮團隊開發資料

更新日期：2026 年 11 月 5 日。團隊預計於 **11 月 6 日星期五**統整各自的開發與發想；活動日為 **11 月 7 日星期六**。

我們已決定開發一款多人點陣訂餐遊戲。揪團者分享網址，大家操控角色逛店、進店看點陣餐點與價格，按 ＋1 訂餐，最後由揪團者統計並向店家訂購。現在請各組員以同一份核心規格探索實作，明天帶回可展示的成果、取捨與新點子。

## 先閱讀

1. 開啟 `lunch-town-handoff.html`：附圖的單檔閱讀版，不需安裝工具，也不需要網路即可閱讀內文與示意圖。
2. 閱讀 [development-spec.md](development-spec.md)：產品與實作規格的主要來源。
3. 以 [proposal-template.md](proposal-template.md) 記錄各自的成果與發想。
4. 開發時使用 [contracts.ts](contracts.ts) 與 [menu.sample.json](menu.sample.json) 對齊命名、資料與介面。

## 文件定位

- **已定案**：多人共用網址、點陣角色逛店與進店、點陣餐點與價格、個人餐點加減、揪團者彙整。
- **建議基準**：MVP 範圍、介面契約、同步規則與驗收方式，供組員先各自實作。
- **明天統整**：技術選型、正式名稱、街區視角、素材製作方式、加分功能與整合負責人。

技術建議不代表團隊已表決通過。可以用自己熟悉的工具探索，交回成果時請標明與契約的差異。這份資料包包含規格、範例資料與畫面參考，尚未包含遊戲程式或可部署成品。

## 圖片與分享

- [街區參考](assets/street-reference.png)：視覺參考，街區角度尚待統整。
- [已確認的店內方向](assets/shop-interior-approved.png)：暖色點陣店內、角色與櫃檯、右側餐點和個人訂單。
- `lunch-town-handoff.html` 已內嵌圖片，單獨傳送也可閱讀。
- 若要連同可編輯資料一起傳送，分享專案 `output` 目錄的 ZIP 資料包。

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

Sites 前端以短輪詢取代 Socket.IO：房間每次完成回應後約 250ms 再同步，店家每秒檢查更新；實際延遲另加網路時間。斷線會顯示離線並自動重試。角色在線資訊存於 D1 `live_presence`，以分頁識別碼區分連線，10 秒未更新即不再顯示；位置不影響訂單版本。伺服器從 Cookie 推導角色身分，重新核對房間與店家權限。

工作階段使用 Secure、HttpOnly、SameSite=Lax Cookie。同一瀏覽器會沿用原有身分；跨瀏覽器須重新加入，店家可使用管理碼找回。`DEMO_KEY` 預設為 `demo`，空字串可停用展示用種子店認領；正式公開營運前請自行設定管理方式。收款功能維持原本的人工回報／確認，沒有串接或執行金流。

新增 Site 預設為私人；部署不會自動開放任何持有網址者存取。
