# 店家自訂餐點圖片（#25）

店家後台的餐點編輯器可按「更換餐點圖片」，選擇 PNG／JPEG 照片，預覽後套用，再儲存餐點。原本的 19 張內建圖片仍可選擇。

## 處理與限制

- 照片最多 5 MB、1600 萬像素、單邊最多 8192 像素；瀏覽器在解碼前檢查檔頭與尺寸。
- 提供置中裁切與保留完整照片兩種構圖。瀏覽器縮成 32×32，再量化為 64 色及透明；原始照片不離開瀏覽器。
- API 只接受 4096 個 RGBA 整數，伺服器重新驗證與量化，再產生固定規格的 PNG，不接受任意檔案或 SVG。
- 每店最多 100 張自訂圖片，相同處理結果重試不重複計數；儲存前後均檢查原本的店家權限與額度。

圖片讀取是公開菜單資源，不需要店家授權；上傳與套用仍透過既有的 `requireOwner`，不可套用其他店家的圖片。沒有新增帳號、管理員角色或邀請授權；這些仍由 #21、#38 處理。

## 資料保存

`server/images/schema.ts` 的 `meal_images` 表只保存店家、圖片識別碼、物件路徑與時間，PNG 本體獨立保存。Node 啟動與 Worker 開啟舊 SQLite image 時共用冪等建表，無須變動 D1 外層的 Drizzle schema。

- Node：圖片位於 `DATA_DIR/images/meal-images/`，啟動時不清空。完整寫入暫存檔後才登記正式檔，重試不覆寫舊檔。
- Sites：透過 R2 `BUCKET` binding 保存；`.openai/hosting.json` 已宣告 `r2: "BUCKET"`，本機 Wrangler 也有對應 binding。合併後重新建置部署時必須配置此 binding，缺少時上傳回傳可重試錯誤。
- 識別碼包含店家與量化像素的 SHA-256，圖片不變，Worker 可安全使用 immutable 快取。換圖只修改店家目前菜單的識別碼；既有團的 catalog 快照及原圖片保留。

檔案成功而 metadata 提交失敗時，可能留下未引用物件；目前不自動清除，也不刪除已換掉的圖片，以免破壞舊團。清理與保留政策依 #11 後續實作。

菜單直接使用圖片 API；店內 canvas 在圖片載入完成後重新建立陳列台。讀取失敗先顯示內建圖片，保留正常點餐操作。

## 驗證

```sh
npm run typecheck
npm test
npm run build
SITES_TEST_URL=http://127.0.0.1:8799 node scripts/test-meal-images.mjs
SITES_TEST_URL=http://127.0.0.1:8799 node scripts/test-sites.mjs
```

兩支整合腳本只允許 localhost，請先啟動獨立的本機 Worker／D1／R2。圖片腳本驗證 PNG 解碼、同圖去重、上傳與跨店權限、換圖及舊團快照；單元測試另涵蓋檔案限制、CRC、儲存失敗、權限撤銷、額度競爭與 Node 檔案持久化。

瀏覽器驗收需確認：上傳預覽、套用並儲存、建立新團、菜單與陳列台顯示圖片。正式 Sites 的 R2 配置與跨裝置驗收於合併部署後執行；本 PR 不操作雲端資料。
