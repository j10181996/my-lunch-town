# 午餐小鎮：我們的版本實作規劃

撰寫日期：2026-11-05（v2：加入店家端開店介面）　目標：11/6 統整前帶回「可雙瀏覽器操作的完整小原型」＋填好的 `proposal-template.md`

## 0 定位

依 `development-spec.md` 做 **完整 P0 縱切**（開團 → 加入 → 走路進店 → ＋1 → 即時彙總 → 收單 → 匯出），加上兩個 P1（同場角色、點餐泡泡）。後端交易與去重照規格第 10 節實作，不用 mock 交差；美術全部用程式繪製的點陣圖，不依賴外部素材或 AI 生圖，確保今晚做得完且風格一致。

**我們版本的主要差異：店家端「開店」介面。** 原規格的菜單是寫死的 JSON；我們讓店家自己在小鎮租一個店面、取店名、選店面風格、上架餐點與價格、切換營業中／休息中。揪團開團時，小鎮上「營業中」的店家就會出現在街區。這讓小鎮從固定 Demo 變成可以真的被店家使用的平台，也解決規格第 13 節「店家來源」待決項。

我想驗證的兩個問題：
1. **「同步 SQLite 交易 + revision 通知 + HTTP snapshot 對齊」這套最簡架構，能不能在單機上就滿足規格所有並發、去重、鎖單驗收項？**
2. **店家能不能在 2 分鐘內不靠說明完成開店並上架三道菜？**

## 1 角色

| 角色 | 能做的事 |
| --- | --- |
| 店家 | 開店（店名、店面風格、選地段）、管理菜單（新增／修改／下架／排序）、切換營業狀態；查看收單後送到本店的訂單、接單／拒單並更新製作與取餐狀態 |
| 揪團者 | 同原規格：開團、邀請、訂自己的餐、看彙總、收單、匯出 |
| 參與者 | 同原規格：加入、逛店、改自己的餐、看自己的金額 |

三種身分都是匿名 Cookie 工作階段；同一瀏覽器可以同時是某店店家和某團成員。

## 2 技術選型

| 層級 | 選擇 | 理由 |
| --- | --- | --- |
| 前端建置 | Vite + TypeScript | 規格建議基準 |
| 面板 UI | React 18 | 菜單、我的訂單、統計、店家後台這類表單／狀態面板寫起來最快 |
| 遊戲呈現 | Canvas 2D 自寫（無引擎） | 只需地圖、角色、互動區、場景切換；關閉平滑、整數倍放大 |
| 伺服器 | Node 26 + Fastify | 單一服務同時供應靜態檔、API、Socket |
| 即時 | Socket.IO v4 | 規格建議；內建重連 |
| 資料庫 | Node 內建 `node:sqlite`（同步 API） | 免原生編譯；同步呼叫 + `BEGIN IMMEDIATE` 天然序列化點餐與收單 |
| 測試 | Vitest（領域邏輯與 API）、Playwright（雙瀏覽器煙霧測試，有時間再做） | 規格要求自動測試優先放在計價、去重、並發、收單 |
| 身分 | HttpOnly Cookie `lt_sid`（隨機 token） | 規格第 9 節 |

## 3 目錄結構（對齊規格第 12 節建議邊界）

```text
DevDays/
  shared/
    contracts.ts          沿用原檔，只加不改（新增店家相關型別，見第 10 節）
    catalog/seed.json     由 menu.sample.json 轉成三家示範店家的種子資料
    pricing.ts            彙總與匯出文字的純函式（前後端共用、可單測）
    lots.ts               街區店面地段定義（門口座標、招牌位置）
  server/
    index.ts              Fastify + Socket.IO + 靜態檔
    db.ts                 schema、交易包裝、busy 重試、種子資料
    session.ts            Cookie 工作階段
    stores/               開店、店家資料、菜單 CRUD、營業狀態、管理碼認領
    rooms/                開團（凍結菜單）、加入、snapshot、public info
    orders/               order-delta、close、summary、export、店家訂單
    realtime/             socket 驗證、room:changed、presence 記憶體表
    test/                 Vitest
  web/
    main.tsx
    adapters/             RoomGateway / StoreAdminGateway：http 實作與 mock
    state/                snapshot store、revision 判斷、pending 請求表
    game/                 canvas 迴圈、輸入、場景、碰撞、sprite 繪製
    art/                  程式點陣素材：角色、餐點圖庫、店面風格、街區、店內
    ordering/             菜單、我的訂單、揪團統計、收單、匯出
    shop-admin/           開店精靈、菜單編輯、營業切換、店面預覽、店家訂單
    pages/                首頁（我要揪團／我要開店）、開團、加入、房間、店家後台、找不到
```

開發：`npm run dev`（Vite 5173 代理 `/api` 與 `/socket.io` 到 3000）。展示：`npm run build && npm start`，單一網址 3000。

## 4 店家端開店介面

### 4.1 流程

1. 首頁兩個入口：「我要揪團」「我要開店」。
2. **開店精靈（三步，一頁完成）**
   - 店名（1–12 字）。
   - 店面風格：從 4–6 款點陣店面選一款（便當／麵店／素食／飲料／咖哩…），決定街區外觀與店內配色，對應 `interiorAssetKey`。
   - 地段：街區上有固定 6 個店面格，顯示小地圖點選空位；被占用的格子反灰。
   - 送出後建立店家，取得**店家後台網址 `/shop/{storeId}`** 與**一次性顯示的管理碼**（換裝置或清 Cookie 時用來認領，伺服器只存雜湊）。
3. **店家後台**
   - 左：即時預覽自己的點陣店面與店內招牌（改店名、風格立刻看到）。
   - 右：菜單編輯表格，每列＝餐點圖、名稱、價格（非負整數新台幣）、供應中開關、標籤、上下移、刪除。「新增餐點」開一列空白。
   - 餐點圖：從內建點陣餐點圖庫挑（九道示範菜 + 飲料、湯、甜點等通用圖約 15–20 張）；缺圖時顯示通用便當盒。
   - 上方大開關：**營業中／休息中**。至少一道供應中餐點才能切到營業中。
4. **訂單**：收單交易內依店送單，後台即時收到團名、揪團者、送出時間、品項彙總與每人明細。店家可接單或附原因拒單，接單後更新製作中／可取餐；團購成員即時看到回覆。進行中的訂單在上方，今日結束的訂單收合在「今天已完成」。

### 4.2 菜單與進行中團購的關係（關鍵規則）

規格要求「開團綁定一版菜單，該團進行中不改價」。做法：**開團時把當下所有營業中店家的店家資料與供應中餐點複製成該團的凍結菜單**（`room_stores`、`room_meals`），`catalogVersion = "room:{roomId}"`。

- 店家之後改價、改名、下架、休息，**只影響之後開的新團**，進行中的團不變，彙總與匯出也不受影響。
- 後台顯示提示：「修改只套用到之後開的團；目前有 N 個進行中的團使用舊菜單」。
- 優點：點餐、彙總、匯出完全只讀 room_* 表，原規格的交易規則一行不用改。

### 4.3 不做的事

不做店家登入帳號、付款、庫存、營業時間排程、上傳自訂圖片。（點陣圖編輯器列為加分候選，見第 8 節。）

## 5 資料庫 schema

```sql
-- 店家端（可變動的「主檔」）
stores(id PK, name, style_key, lot_index UNIQUE, status CHECK(status IN ('open','resting')),
       owner_session_id, manage_key_hash, is_sample, updated_at)
meals(id PK, store_id, name, price_twd CHECK(price_twd >= 0), image_key, available, tags_json, sort_order)

-- 團購端（開團時凍結）
rooms(id PK, title, status CHECK(status IN ('open','closed')), catalog_version, revision INT, created_at, closed_at)
room_stores(room_id, store_id, name, style_key, door_x, door_y, PRIMARY KEY(room_id, store_id))
room_meals(room_id, meal_id, store_id, name, price_twd, image_key, available, tags_json, sort_order,
           PRIMARY KEY(room_id, meal_id))

sessions(id PK, created_at)
members(id PK, room_id, session_id, nickname, display_suffix, avatar_id, role, UNIQUE(room_id, session_id))
order_items(room_id, member_id, meal_id, quantity CHECK(quantity BETWEEN 1 AND 20), unit_price_twd,
            PRIMARY KEY(room_id, member_id, meal_id))
processed_requests(scope, actor_id, request_id, payload_digest, result_json,
                   PRIMARY KEY(scope, actor_id, request_id))
```

- 啟動時若 `stores` 為空，從 `seed.json` 寫入三家示範店（`is_sample=1`、營業中），維持規格第 11 節 fixture 可驗收。
- `scope` 區分 `create-room`、`create-store`（以 session 為鍵）、`order`、`close`。
- WAL 模式、`busy_timeout`；所有寫入走同一個 `withWriteTx(fn)`，忙碌短暫重試後回 `RETRY_LATER`。
- 店家寫入權限：`stores.owner_session_id = 目前 session`，否則 403。

## 6 關鍵流程實作要點

**開團**：交易內讀取所有 `status='open'` 店家與其供應中餐點 → 寫入 room_stores / room_meals → 建立 room 與 owner 成員。沒有任何營業中店家時回 `INVALID_INPUT`（畫面提示「小鎮目前沒有營業中的店」）。

**點餐交易（規格第 10 節六步，順序照抄）**：驗身分 → `BEGIN IMMEDIATE` → 查 `processed_requests`（同 ID 同內容回原結果、不同內容回 `REQUEST_ID_CONFLICT`，此步早於收單檢查）→ 檢查 open、餐點存在於 `room_meals` 且 available、delta ∈ {1,-1} → 計算新數量（<0 或 >20 回 `INVALID_INPUT`）→ upsert/刪除、`revision+1`、寫去重結果 → COMMIT → 回 `OrderAck` 並 emit `room:changed`。

**收單**：同一交易序列，驗 owner，`open→closed`、記 `closed_at`、`revision+1`；已收單重試回目前 snapshot。同交易建立各店 `store_orders` 快照；提交後 emit `store:orders-changed` 給該店家後台。

**客戶端一致性**：
- 收到 `room:changed` 且 revision 較新 → 重取 snapshot（owner 同時重取 summary）；丟棄舊 revision 回應。
- 加入、重連、視窗 focus 時都重取 snapshot。
- ＋1／−1 採「成功後更新」：每個餐點同時只允許一個 pending，按鈕顯示處理中；逾時或 503 用**同一 requestId** 重試；pending 存 `sessionStorage`，重新整理後先重送釐清結果。
- 斷線時顯示提示並停用修改按鈕，重連後才恢復。

**店家後台儲存**：菜單編輯採逐列儲存（失焦或按儲存即 PATCH），價格欄只接受整數；儲存中／已儲存／失敗的狀態顯示在該列。後台無需即時同步給團購端（因為團購用凍結菜單）。

**Presence**：記憶體 `Map<roomId, Map<memberId, PlayerPresence>>`；客戶端節流 10 次/秒送 `player:move`，伺服器以 ~10Hz 合併廣播 `presence:snapshot`。Socket 握手讀 Cookie，`room:subscribe` 時驗證成員資格才 join。

## 7 畫面與遊戲

**團購版面**：沿用已確認圖結構 —— 上方列（團名／在線人數／邀請連結）、左側 canvas 場景、右側面板（街區時顯示揪團統計或我的訂單；店內時顯示該店菜單 + 我的訂單）。

**街區視角：先做俯視（top-down）**。斜角依規格是明天決定項；俯視的碰撞與門口判定最簡單，邏輯座標 0..1 不受影響。

- 邏輯解析度 320×180，整數倍放大，`imageSmoothingEnabled=false`。
- 街區：上下兩排共 **6 個店面格**（`shared/lots.ts` 定義每格的門口座標），依該團 room_stores 畫出對應風格的店面與 HTML 疊加的店名招牌；空格畫成「招租中」空地。
- 店內：共用一套櫃檯／桌椅版型，依 `style_key` 換配色與招牌；出口墊踩上即返回，出生在該店門外並設冷卻。
- 操作：方向鍵／WASD；門口顯示「按 E 進店」與可點擊按鈕；輸入框聚焦時不攔截鍵盤。
- 手機替代：右側面板永遠有「前往店家」按鈕列表，直接切到店內。

**點陣素材（程式繪製）**：以字串像素圖 + 調色盤定義 sprite，啟動時畫到離屏 canvas 快取；街區、店內、店家後台預覽共用同一套繪製函式。
- 角色 16×24（×3），4 方向 × 2 幀走路，5 種配色對應 `avatarId`。
- 餐點圖庫 32×32（×3 = 96），約 15–20 張，九道示範菜各一張；缺圖用通用便當盒。
- 店面風格 4–6 款，每款含街區店面與店內配色。

## 8 功能分級與今晚順序

| 階段 | 內容 | 完成判定 | 預估 |
| --- | --- | --- | --- |
| M0 骨架 | 專案初始化、Vite 代理、Fastify、SQLite schema、種子資料、共用契約 | `npm run dev` 前後端都起得來 | 0.5h |
| M1 後端核心 | 開團（凍結菜單）、加入、snapshot、order-delta、close、summary、export、public info | Vitest：fixture 410 元、去重、衝突、並發 +1、收單競態、權限全過 | 1.5h |
| M2 店家端 | 開店 API 與精靈、菜單 CRUD、營業切換、管理碼認領、後台預覽 | 新店家開店上架三道菜後，新開的團看得到它；舊團不受改價影響 | 1.5h |
| M3 點餐介面 | 首頁、開團/加入頁、店家選單、菜單 ＋1/−1、我的訂單、揪團統計、收單確認、複製匯出 | 兩個瀏覽器只靠按鈕就能走完 P0 | 1.5h |
| M4 遊戲場景 | 6 格街區、角色移動、碰撞、門口提示、進店/返回、店內場景 | 30 秒內可走進兩家店再出來 | 1.5h |
| M5 即時 | Socket 驗證、room:changed 刷新、重連提示、presence 同場角色 | A 按 ＋1，B 的統計 1 秒內更新；看得到彼此走動 | 1h |
| M6 點陣美術 | 角色配色、餐點圖庫、店面風格、街區與店內細節 | 與已確認店內圖風格接近 | 1h |
| M7 收尾 | 驗收清單、錄備份影片、填 proposal-template | 第 9 節清單全打勾 | 0.5h |

合計約 9h，今晚做不完全部。**刪減順序**：M6 美術簡化（店面風格先 3 款、圖庫只放 9 張）→ presence 同場角色 → 店家「今日訂單」→ 遊戲改成只有街區＋按鈕進店。**不刪**：訂單同步、收單、匯出、開店＋菜單編輯＋凍結菜單。

### 加分候選（只挑一個）

1. **點餐泡泡**：任何人 ＋1 成功後角色頭上冒出「雞腿飯 +1！」，同場景的人都看得到（已確認示意圖有此元素）。伺服器提交成功後送 `player:bubble`；可整段關閉。注意會讓別人看到你點了什麼，列入明天討論。
2. **店家今日訂單**（第 4.1 節第 4 點）：把「揪團者自行聯絡店家」變成店家直接看到彙總，Demo 可多一個畫面。
3. **點陣餐點畫板**：店家後台 32×32 小畫板自繪餐點圖，存成像素字串。最有趣但最花時間。

建議：先做 1（成本最低、示意圖已有），時間有餘再做 2。

### 一分鐘 Demo 調整

| 秒數 | 畫面 | 說明 |
| --- | --- | --- |
| 0–10 | 店家後台：把「咖哩飯 130 元」上架、切營業中 | 店家自己開店上菜單 |
| 10–18 | 揪團者開團，街區出現新店；分享網址第二人加入 | 分享網址，大家一起進午餐小鎮 |
| 18–33 | 角色走入店內，看點陣餐點與價格，＋1 | 走進店裡挑餐 |
| 33–47 | 兩個瀏覽器點餐，統計即時增加 | 揪團者直接看到彙總 |
| 47–60 | 收單、複製明細（若有：店家後台同時跳出本店訂單） | 整理好就能訂餐 |

## 9 驗收（對應規格第 14 節，加上店家端）

自動（Vitest，直接打 API，用多組 Cookie 模擬多人）：
- [ ] 開團與加入得到不同 `memberId`；同 Cookie 重新加入恢復原成員。
- [ ] 第 11 節 fixture → 4 份 / 410 元，個人 120 / 230 / 60；匯出文字與範例逐字相同。
- [ ] 減到 0 刪列、從 0 減一被拒、超過 20 被拒。
- [ ] 兩人同時對同餐點 ＋1 → 總數 +2（`Promise.all` 並發）。
- [ ] 同 requestId 重送只加一次；同 ID 不同內容回 409 `REQUEST_ID_CONFLICT`。
- [ ] 收單與 ＋1 並發：先提交者生效，結果與 revision 一致；收單後重送已成功的 requestId 仍回原結果。
- [ ] 非 owner 收單、讀 summary、export 皆 403；未收單 export 被拒。
- [ ] **店家改價後：進行中的團仍以舊價計算與匯出；新開的團用新價。**
- [ ] **休息中的店、下架的餐點不出現在新開的團；在舊團中照舊可點。**
- [ ] **非該店 session 不能改該店資料（403）；管理碼可認領、錯誤管理碼被拒。**
- [ ] **地段重複被拒；價格非整數或負數被拒；無供應中餐點不能切營業中。**

手動（兩個瀏覽器設定檔）：
- [ ] 新店家 2 分鐘內完成開店並上架三道菜（找一個沒看過的人試）。
- [ ] 走到兩家店、進店、返回正確門口。
- [ ] 重新整理與拔網路重連後訂單仍在、無重複加單。
- [ ] 無效網址、空訂單、缺圖、複製失敗、小鎮沒有營業中店家都有可繼續的畫面。
- [ ] 一分鐘 Demo 排練一次並錄備份影片。

## 10 與共用契約的差異（明天回報用，實作中持續更新）

| 原規格或欄位 | 我的改動 | 原因 | 對其他模組的影響 |
| --- | --- | --- | --- |
| 菜單來自固定 JSON，範圍不含店家系統 | 新增店家端：stores / meals 主檔、開店與菜單編輯 API | 店家自己開店上菜單 | 需新增後台頁；團購端只讀凍結菜單，點餐規則不變 |
| `catalogVersion` 為全域菜單版本 | 改為每團一份凍結菜單，`catalogVersion = "room:{roomId}"` | 店家可隨時改菜單，但進行中團不能改價 | `Catalog` 形狀不變，消費端無感 |
| `Store` 型別 | 新增選填 `styleKey`、`lotIndex`；`door` 由地段推得 | 店面風格與街區格位 | 純新增欄位 |
| 無 | 新增 `StoreAdminGateway`、`StoreProfile`、`MealDraft` 型別 | 店家端介面 | 純新增 |
| 無 | 新增 API：`POST /api/stores`、`GET/PATCH /api/stores/:id`、`POST /api/stores/:id/meals`、`PATCH/DELETE /api/stores/:id/meals/:mealId`、`POST /api/stores/:id/status`、`POST /api/stores/claim`、`GET /api/stores/:id/orders` | 店家端 | 純新增 |
| 無 | 新增 `GET /api/rooms/:id/public` → `{title, status}` | 加入頁需在加入前顯示團名，但 snapshot 需成員身分 | 純新增 |
| 無 | 新增 socket 事件 `room:subscribe`、`player:bubble`、`store:orders-changed` | 連線後驗證才訂閱；加分功能 | 純新增 |
| 原規格第一版不含店家接單系統 | 新增 `store_orders` 固定快照，同收單交易依店建立；狀態變更同交易遞增房間 revision | 收單後直接送店家並追蹤回覆 | 不更動點餐交易、凍結菜單或原有表 |
| 無店家訂單 API | `GET /api/stores/:storeId/orders`、`POST /api/stores/:storeId/orders/:orderId/status` | 目前店家擁有者讀取最近 50 筆並更新狀態 | 純新增；換人認領可見舊單 |
| `RoomSnapshot`、店家契約 | 宣告合併選填 `storeOrders?: RoomStoreOrder[]`，伺服器一律填；新增訂單型別與 gateway 三方法 | 全員查看各店狀態與拒單原因 | 不含店家每人明細；未收單為空陣列 |
| 店家尚無即時訂閱 | 新增 `store:subscribe`、`store:orders-changed`，獨立 socket 連線 | 店家新單與狀態即時刷新 | 店家訂閱需擁有權；通知只在提交後發送 |
| 外送規則與送餐地點原無契約 | 宣告合併新增 `DeliveryRules`、`Store.delivery?`、`StoreProfile.delivery`、`Room.deliveryPoint?`、`CreateRoomInput.deliveryPoint?`、`StoreAdminGateway.setDelivery` | 店家提供最多 5 段距離／最低金額，開團選 0..1 地點 | 規則於開團複製到 `room_stores`，snapshot 使用凍結值；開團 digest 包含地點 |
| 原訂單未記錄送餐方式 | `RoomStoreOrder`（`StoreOrder` 繼承）新增 `fulfillment`、`distanceKm`、`deliveryMinTwd` | 收單依凍結規則、直線距離、該店小計決定外送或自取 | 收單輸入不變，沿用原交易邊界與送單狀態機；未達標可確認後自取送出 |
| 無外送設定 API | 新增擁有者限定 `PUT /api/stores/:storeId/delivery` → `StoreProfile` | 儲存外送開關與分段門檻 | 錯誤走 `AppError` 與中央處理；純函式驗證錯誤在 API 邊界轉成 `err.invalid` |
| 無收款資訊與付款紀錄 | 新增 `PaymentMethod`／`PaymentInfo`；`RoomSnapshot.payment?`、`myPayment?`；`OwnerSummary.paymentProgress?` | 只傳遞收款資訊、不經手金流；非團主且收單金額 > 0 才需付款 | 未傳送草稿只對團主可見；傳送後所有成員可見收款資料 |
| `OwnerSummary.people` 使用內嵌型別 | 抽成等價 `OwnerSummaryPerson`，再宣告合併 `paymentStatus?` | 擴充每人付款狀態 | 原有欄位與行為不變；團主或零元成員狀態為 null |
| 無收款 API | 新增 `PUT /api/rooms/:id/payment-info`、`POST /api/rooms/:id/payment-info/send`、`POST /api/rooms/:id/payment/report`、`POST /api/rooms/:id/payment/:memberId/confirm` | 團主設定／傳送、團員回報、團主確認與取消 | `RoomGatewayExt` 新增四方法；原 `RoomGateway` 不變；實際變更同交易遞增 revision、提交後廣播，重試不變 |
| 餐點素材 96×96、角色 32×48 | 來源 32×32 / 16×24，×3 顯示 | 程式手繪像素圖的成本 | 素材格式待明天統一 |
| 街區視角未定 | 先做俯視、6 個固定店面格 | 碰撞最簡單；店家數量可變需要格位 | 邏輯座標不變，可換投影 |

## 11 已拍板（2026-11-05）

1. 店家端必做**開店＋菜單管理**；「今日訂單」列為加分候選。
2. 店家身分用 **Cookie＋一次性管理碼**，不做帳號。
3. 面板用 **React**；街區先做 **俯視**。
4. 由 Claude 直接實作。

## 12 實作現況（2026-11-05 晚）

啟動：`npm install` → 開發 `npm run dev`（http://localhost:5173）；展示 `npm run build && npm start`（http://localhost:3000，同網址供應網頁、API、Socket）。
測試：`npm test`（90 項 API／交易、外送與收款純函式及遷移測試）、`npm run typecheck`、雙瀏覽器煙霧測試 `node scripts/smoke.mjs`（需先 `npm start`，使用本機 Chrome）。
本次接單流程驗證：型別檢查、Vite 建置與 23 項測試通過；擴充後煙霧測試尚待執行，本機沙盒禁止服務監聽（`listen EPERM`）。
示範店家管理碼：`demo-store-af`、`demo-store-tree`、`demo-store-green`。

| 項目 | 狀態 |
| --- | --- |
| M0 骨架、M1 後端核心、M2 店家端、M3 點餐介面、M4 遊戲場景、M5 即時、M6 點陣美術 | 已完成，自動測試與煙霧測試通過 |
| 加分：點餐泡泡 | 已完成 |
| 店家今日訂單與接單流程 | 已完成：收單原子化送單、接單／附原因拒單、製作中／可取餐、雙端即時狀態與新單提示 |
| 外送設定與送餐地點 | 已完成：店家分段設定、首頁地圖選點與記憶、街區旗子、即時門檻進度、收單警告與外送／自取標示 |
| mock gateway（離線展示） | 未做；目前只有 http 實作 |
| 手機版 | 版面可縮成上下兩欄並以「前往店家」按鈕進店；沒有觸控移動 |
| 手動驗收：拔網路重連、無痕視窗雙人、一分鐘 Demo 排練與備份錄影 | 尚未進行 |

實作中新增的契約差異（補充第 10 節）：
- 找不到店家回 HTTP 404 + `INVALID_INPUT`（契約 `ErrorCode` 沒有店家專用碼）。
- 新增 `POST /api/stores/:id/meals/:mealId/move`（排序）、`GET /api/town`、`GET /api/my/stores`。
- `RoomGateway.subscribe` 每次訂閱成功（含第一次）都呼叫 `onReconnect`，UI 以此重取 snapshot 並標示上線。
- 重名暱稱顯示為 `阿凱#2`。

本輪外送（2026-11-06）：
- 距離以 `shared/delivery.ts` 純函式共用：正規化座標換世界像素，每像素約 4 公尺，直線距離四捨五入至 0.1 公里。這是依地段經度跨距換算的近似值，非道路距離。
- 啟動時 `PRAGMA table_info` 檢查並以 `ALTER TABLE ADD COLUMN` 補齊店家／團購規則、地點與訂單方式；新資料庫也走同一套遷移。
- DDL 與種子回填同一交易。只有首次補上 `stores.delivery_json` 時，依 `openDb` 傳入的種子檔回填有規則且仍為 NULL 的店；之後不再回填，店家設定不會被啟動覆蓋。台中種子僅壯壯餐盒設定 2／3／4／5 公里，滿 300／500／800／1200 元。
- 既有團購不追補規則、既有訂單預設自取；店家修改只影響新團。無地點的開團保留原 digest，升級前成功請求仍能重試。
- 驗證：`npx tsc --noEmit -p .`、`npx vite build`、`npx vitest run`（52 項，含原有 23 項）通過；煙霧腳本語法檢查通過。
- 煙霧腳本已加入首頁地圖選點、收單前外送說明與收單後自取標示檢查，待使用者執行雙瀏覽器與截圖驗收。

本輪收款（2026-11-06）：
- 只傳遞收款資訊、不經手金流；不含線上付款、自動對帳、QR code 上傳或提醒推播。
- `rooms` 以 `PRAGMA table_info` 檢查，交易內增欄 `payment_json TEXT`、`payment_sent_at INTEGER`，預設 NULL。
  新增 `member_payments(room_id, member_id, status, reported_at, confirmed_at)`，複合主鍵，status 限 reported／confirmed。
  保留既有資料與外送遷移行為；重啟不覆蓋收款資料。原外送遷移測試僅補上兩個 NULL 欄位預期值。
- 開團中可儲存草稿，僅團主可見；收單後可傳送，傳送時間不因重試或修改而改變。
- 非團主且收單金額 > 0 的成員可回報付款；團主可直接確認收到。取消確認回到 reported（曾回報）或刪除紀錄（未回報）。
- 團主街區側欄提供 1–4 種收款方式與備註，成功儲存後記憶於 `lt-payment-info`；每人明細含狀態、確認／取消與收款進度。
  團員收到後看到金額、帳號與 ID 複製、付款回報卡片；收到資訊與確認款項時即時提示。
- 煙霧腳本保留原送單／店家狀態步驟，接續新增銀行＋LINE Pay 設定、傳送、NT$130 付款卡片、回報與團主確認，截圖 17–21。
- 本輪驗證：`npx tsc --noEmit -p .`、`npx vite build`、`npx vitest run`（90 項，原有 54 項與新增 36 項）全部通過；`node --check scripts/smoke.mjs` 通過。
  雙瀏覽器煙霧與實際截圖留待使用者驗收，尚未執行。
