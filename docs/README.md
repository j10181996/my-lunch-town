# 文件索引

啟動、建置與部署見根目錄 [README](../README.md)；代理開發規則見 [CLAUDE.md](../CLAUDE.md)。工作範圍與決策以 [GitHub issues](https://github.com/j10181996/my-lunch-town/issues) 為準。

## 目前有效的指南

| 文件 | 內容 |
| --- | --- |
| [開發指南](development.md) | 架構分層、Node／Sites 共用方式、常見修改步驟與測試 |
| [Git 流程](git-flow.md) | 分支命名、commit、PR 描述與合併方式 |
| [Sites 團單與角色同步](sites-sync.md) | 輪詢同步、資料分層、輪詢間隔與延遲實測（#39） |
| [店家自訂餐點圖片](custom-meal-images.md) | 照片上傳、32×32 點陣轉換與圖片保存（#25） |
| [台中八家新店種子](taichung-seed-expansion.md) | 真實店家種子的店家、地段與資料來源（#67） |

## 交接與驗證紀錄（`records/`）

各功能完成當時的展示範圍、簡化之處與地端驗證結果。內容反映當時狀態，現況以程式與 issue 為準。

| 文件 | 對應 issue |
| --- | --- |
| [來源基線與驗證紀錄](records/baseline.md) | #37 |
| [M4 黑客松展示交接](records/m4-demo-handoff.md) | #30、#33–#36 |
| [手機觸控操作交接](records/mobile-controls.md) | #18 |
| [新手任務與全團合照](records/journey-demo.md) | #55 |

`records/local/` 是各次地端驗證的環境與暫存資料紀錄（安裝了什麼、測試資料放哪、如何清理）。

## 歷史規格（`archive/`）

黑客松前的來源規格與規劃，保留原樣作為參考，**不代表目前決策，也不要修改**。

| 文件 | 內容 |
| --- | --- |
| [development-spec.md](archive/development-spec.md) | 原始開發規格；參考圖在 `archive/assets/` |
| [lunch-town-handoff.html](archive/lunch-town-handoff.html) | 原始交接文件（含視覺參考） |
| [contracts.ts](archive/contracts.ts)、[menu.sample.json](archive/menu.sample.json) | 原始共用契約與菜單範例；目前契約以 `shared/contracts.ts` 為準 |
| [PLAN.md](archive/PLAN.md) | DevDays 展示版實作規劃 |
| [proposal-template.md](archive/proposal-template.md) | 個人探索回報範本 |
| [full-version-plan.md](archive/full-version-plan.md) | 完整版規劃書 |
