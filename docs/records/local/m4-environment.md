# M4 地端驗證環境

主機：YenMacBook-Air.local（macOS）

2026-11-07，在 `/Users/hsuchiayen/Downloads/hack-day` 執行 `npm ci --no-audit --no-fund`，依既有 package-lock.json 安裝專案依賴至 node_modules。沿用 Node v26.5.1、npm 11.17.0，未修改全域工具、shell 設定或服務。npm 可能寫入使用者既有 npm 快取及日誌；保留共用快取，不做全域清理。

建置輸出 dist、worker/seed.bin 及 Wrangler 本機狀態 .wrangler 均由 .gitignore 排除。測試伺服器只綁定本機，使用 /tmp 的獨立測試資料，結束後停止程序。

回復：停止本次測試程序後，可移除本專案產生的 node_modules、dist、worker/seed.bin、.wrangler；這會移除本機 Wrangler 測試資料，若其中已有其他人的資料則先保留。原始碼依賴清單與 lockfile 不因 npm ci 改動。


驗證產物與暫存：Node 測試資料 `/tmp/lunch-town-m4-test`、`/tmp/lunch-town-m4-sample-test`，Worker 測試資料 `/tmp/lunch-town-m4-worker`，截圖 `/tmp/lunch-town-m4-shots`、`/tmp/lunch-town-m4-sites-shots`、`/tmp/lunch-town-m4-full-smoke`。均為本次建立的合成測試資料，保留供檢視，可在確認不需測試證據後刪除。Wrangler 亦可能在既有使用者設定目錄寫入日誌與遙測設定；未修改雲端資源、部署或帳號權限。
