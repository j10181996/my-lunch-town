# 手機操作地端驗證紀錄

主機：YenMacBook-Air.local（macOS）

2026-11-07，在 `/Users/hsuchiayen/Downloads/hack-day` 沿用既有 node_modules、Node v26.5.1、npm 11.17.0 與 Google Chrome。未新增依賴、全域工具、設定或雲端服務。

Node 測試資料：`/tmp/lunch-town-18-test`。Sites 本機 Worker 資料：`/tmp/lunch-town-18-worker`，以 Wrangler local migrations 初始化，只使用合成測試訂單。截圖在 `/tmp/lunch-town-18-shots`、`/tmp/lunch-town-18-sites-shots`、`/tmp/lunch-town-18-desktop-shots`。建置輸出 dist、worker/seed.bin 由既有 .gitignore 排除；Wrangler 可能寫入既有使用者日誌目錄。

測試程序只綁定 127.0.0.1，完成後停止。測試資料和截圖保留供查驗；確認不需保留後可刪除上述本次建立的 /tmp 目錄。未清理其他人的資料或共用快取。


M4 相容性驗證使用暫時 detached worktree `/tmp/lunch-town-18-m4-check`，node_modules 僅連結回原專案；未安裝新套件。合併測試資料在 `/tmp/lunch-town-18-m4-data`，截圖在 `/tmp/lunch-town-18-m4-shots` 與 `/tmp/lunch-town-18-m4-social-shots`。驗證完成後以 git worktree remove 移除暫時 worktree；原始測試資料與截圖保留。
