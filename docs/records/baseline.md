# 本機來源基線

本紀錄對應 #37，保留可重現的來源及遷移前檢查結果。使用者已確認來源內容可公開；本機驗證不代表 Sites 相容性已通過。

## 來源

- 來源：本機 lunch-town checkout 的已提交快照。
- Commit：`79f9807ff705dc29854248f5510059f3c4d3661b`。
- 匯入方式：`git archive` 匯出指定 commit 的追蹤檔案；沒有複製 Git 歷史、資料庫、node_modules、環境設定或未提交變更。
- 來源工作目錄的 `server/app.ts` 修改、未追蹤的 `Dockerfile` 與 `.dockerignore` 均未納入。
- 來源已提交版本沒有 Dockerfile，也沒有 `/healthz`；相關工作仍需後續實作。
- 基線保留的業務與畫面程式不變；本次調整 README、忽略規則，並加入本紀錄。
- 推送前確認遠端已有初始 commit `7875c5c1456687cd3099f152459aac783351f9ed`，其 66 個檔案與來源快照一致；本次沿用遠端歷史，只新增文件與忽略規則的變更。
- 推送時遠端新增 Sites 遷移提交 `ad58623`，本次保留該提交並整合 README 與忽略規則，沒有覆蓋其程式變更。

## 本機檢查

以下是整合 Sites 提交前，2026-11-07 使用 Node.js 26.0.0 對原始基線的檢查。按 package-lock 安裝依賴，停用第三方安裝腳本。

|檢查|結果|
|---|---|
|`npm ci --ignore-scripts --no-audit --no-fund`|通過|
|`npm run typecheck`|通過|
|`npm test`|3 個測試檔、90 個測試通過|
|`npm run build`|通過，產物位於 dist/|
|`node scripts/smoke.mjs http://127.0.0.1:3107 smoke-shots`|通過，Chrome 三個獨立工作階段完成店家、團主與團員流程|

煙霧測試使用專用臨時資料目錄與虛構店家種子，覆蓋開店、菜單上架、開團、加入、走路進店、點餐、同步彙總、收單、接單與人工收款確認。加入前取得受保護快照曾回 401，之後加入與後續操作成功，腳本退出碼為 0。截圖位於忽略追蹤的 `smoke-shots/`，內容為測試用資料。

整合 Sites 提交前，逐一比對指定 commit 的 66 個檔案，只有 README 與 .gitignore 與來源不同，另新增本紀錄。之後的 Sites 程式差異由上游 `ad58623` 帶入，詳見其提交。

整合 `ad58623` 後重新按新版 lockfile 安裝依賴，`npm run typecheck`、90 個測試及 `npm run build` 均通過；建置產生 `dist/client` 與 `dist/server`。本次沒有重新執行 Worker 整合測試或 Sites 雲端驗收，不將原始基線的瀏覽器測試視為遷移版已驗收。

## 公開範圍檢查

- 本次只檢查指定快照，未複製或審查整份來源 Git 歷史。
- 快照的常見私鑰、GitHub token、OpenAI API key 與 AWS access key 格式掃描未發現匹配；不代表已完成所有機密或授權審查。
- `shared/catalog/stores.taichung.json` 含真實店家與人工整理的菜單，來源註記涉及個人筆記；預設伺服器會載入此種子，因此 README 的本機指令明確指定虛構種子。
- 使用者於 2026-11-07 明確同意程式碼、素材及真實店家菜單全部公開，並要求推送至 my-lunch-town；目前沒有替來源新增開源授權條款。
- 公開推送目標為 my-lunch-town 的 main，沿用該 repo 的初始歷史；未搬移來源 repo 的其他歷史或未提交工作，亦未部署 Sites。

## 遷移界線

原始基線是匿名 Cookie、管理碼、本機 SQLite 與 Socket.IO 的模式；整合後已包含上游提供的 Sites／D1 與輪詢同步路徑。ChatGPT 登入、公司成員資格與店家邀請仍由各 issue 追蹤。這份基線與本機驗證紀錄不等同 #2 的完整平台可行性或正式上線驗收。
