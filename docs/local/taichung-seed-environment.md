# 台中種子擴充：環境紀錄

主機：YenMacBook-Air.local（macOS）

2026-11-07，專案 `/Users/hsuchiayen/Downloads/hack-day`，Issue #67。

- 使用既有 Node 26／npm、Chrome、Wrangler 與專案 node_modules，未安裝依賴、變更 lockfile、全域設定、PATH 或 Keychain。
- 讀取 `/Users/hsuchiayen/Downloads/drive-download-20261107T050819Z-1-001` 的14份 Markdown，未修改原始下載檔。
- Node 測試使用 `/tmp/lunch-town-67-node` 與重跑的 `/tmp/lunch-town-67-node-final`，API 3000、Vite 5178；Worker 使用 `/tmp/lunch-town-67-worker` 的獨立本機 D1，port8799。
- `/tmp/lunch-town-67-fixture` 保存模擬舊六家 SQLite、合成測試session與舊團預期值。Wrangler 匯入整個 BLOB SQL 時遇到單一陳述大小限制，改於服務啟動前用本機 sqlite3 參數寫入獨立測試D1檔；未使用雲端 DB。
- 截圖保存在 `/tmp/lunch-town-67-node-shots`、`/tmp/lunch-town-67-sites-shots`、`/tmp/lunch-town-67-mobile-regression`，地圖總覽在 `/tmp/lunch-town-67-map/twenty-lots.png`；Worker 日誌在 `/tmp/lunch-town-67-worker.log`。
- 建置更新忽略追蹤的 dist、worker/seed.bin。Wrangler 保留自身在 `~/Library/Preferences/.wrangler/logs` 的本次日誌；不刪除共用工具的其他紀錄。
- 暫時搜尋店面位置的 `.tmp-lot-search.ts` 已移除。測試資料與截圖保留供檢查；不再需要時可僅移除上述本次專用的 `/tmp/lunch-town-67-*` 路徑。原下載資料與專案 data/ 不清除。

- 完整桌面回歸另以虛構種子 `/tmp/lunch-town-67-sample-final` 啟動 Node 正式版 port3100，截圖 `/tmp/lunch-town-67-desktop-final`。原 smoke 的固定直線路徑需在虛構種子環境執行；真實店家與新增店面的行走由擴充煙霧腳本與20門口 BFS驗證。

- 全部測試服務已停止，確認3000／3100／5178／8799均無監聽程序。型別、155個測試、Node／Sites建置、兩環境新店與散步流程、手機回歸及完整桌面流程均通過。
