# 新手任務與慶祝：地端環境紀錄

主機：YenMacBook-Air.local（macOS）

2026-11-07，專案 `/Users/hsuchiayen/Downloads/hack-day`。

- 依最新 main 的既有 package-lock.json 執行 `npm ci --ignore-scripts --no-audit --no-fund`，更新專案 node_modules，補齊隊友付款 QR 功能已新增的 uqr。Node v26.5.1／npm 11.17.0。
- 此功能未新增依賴、修改 lockfile，未安裝全域工具、改 PATH、Keychain 或系統設定。
- 回到其他分支時可依該分支 lockfile 重跑相同 npm ci；node_modules 為可重建的專案依賴。
- 本次建置更新忽略追蹤的 dist、worker/seed.bin；測試資料、截圖與日誌使用 `/tmp/lunch-town-55-*` 專用路徑，保留供檢查，不涉及雲端資料。
- 本機測試服務僅在測試期間啟動；完成後停止。已停止 Node、Vite 與 Wrangler，確認 3000／5178／8799 均無監聽程序。
- 保留 `/tmp/lunch-town-55-node` 與 `/tmp/lunch-town-55-worker` 測試資料，以及 node-shots、sites-shots、mobile-regression、desktop-regression 截圖目錄，供驗收與重跑。確認不再需要後，可僅移除這些本次專用路徑。
- 型別、143 個測試、Sites／Node 建置、新手任務雙瀏覽器、手機與桌面回歸及 Sites 整合驗證均通過。
