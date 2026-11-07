# #18 手機觸控操作交接

分支：`codex/18-mobile-controls`，由 `origin/main` 建立，與 M4 PR #41 分開。Issue #18 已標記 process。

## 操作

- 手機／觸控裝置及 900px 以下視窗，在街景左下顯示虛擬搖桿。按住並拖動控制方向與速度，放開停止，支援斜向移動。
- 沿用遊戲碰撞、進門與多人同步；手指拖出搖桿仍持續控制。放開、pointercancel、失焦、隱藏分頁、舞台尺寸變更、換場或開啟彈窗時停止並重置。
- 店內直接點餐點圖案／陳列台標籤即可加一份；滑過、拖出再回來、長按不會下單。收單、離線、未確認或彈窗時沿用既有禁止點餐規則。
- 手機版面為街景、面板開關、菜單／訂單。可收合面板放大街景，保留原有「前往店家」、菜單 +1、返回街道入口。手機動作提示改用「點一下」。
- 桌面方向鍵、WASD、Enter 及原本面板繼續使用。觸控只作用在遊戲 canvas 和搖桿，不會停用菜單捲動。

無 API、資料庫、依賴或雲端部署變更，隊友合併後依既有 Sites 流程重新建置及部署即可。

## 地端驗證

```sh
npm run typecheck
npm test
npm run build
# 另開終端啟動 npm run dev，以下預設網址可改為本機前端或 Worker
node scripts/smoke-mobile.mjs http://127.0.0.1:5178
node scripts/smoke.mjs http://127.0.0.1:5178 /tmp/lunch-town-18-desktop-shots
```

`smoke-mobile.mjs` 使用 Chromium 的 isMobile、hasTouch、手機尺寸及 DPR，透過 CDP 派送真正觸控事件，不用鍵盤模擬搖桿。涵蓋拖動／鬆開、超出搖桿、取消、失焦、死區、彈窗、收合面板、走路進店、點陳列台、不誤觸下單、店內碰撞、動作按鈕、返回、旋轉、收單鎖定及 pageerror。

**手機尺寸的 Chromium 模擬測試不等於實機 Safari 或 Android Chrome 驗收。** 上場前請用實際 iPhone Safari、Android Chrome 檢查搖桿手感與瀏覽器工具列變化。Issue 保留開啟，直到實機驗收完成。
