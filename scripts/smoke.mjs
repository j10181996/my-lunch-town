// 雙瀏覽器煙霧測試：店家開店上架 → 揪團者開團 → 參與者加入、走進店、+1 → 揪團者即時看到 → 收單匯出。
// 用法：先 `npm run build && npm start`，再 `node scripts/smoke.mjs [baseUrl] [截圖目錄]`
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "smoke-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctxOpts = { viewport: { width: 1400, height: 860 }, deviceScaleFactor: 2 };
const shop = await (await browser.newContext(ctxOpts)).newPage();
const owner = await (await browser.newContext(ctxOpts)).newPage();
const guest = await (await browser.newContext(ctxOpts)).newPage();
for (const [n, p] of [["shop", shop], ["owner", owner], ["guest", guest]]) {
  p.on("pageerror", (e) => console.error(`[${n}] pageerror`, e.message));
  p.on("console", (m) => m.type() === "error" && console.error(`[${n}] console`, m.text()));
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const step = (s) => console.log("•", s);

// 1. 店家開店
step("店家開店");
await shop.goto(`${BASE}/shop/new`);
await shop.getByPlaceholder("例如：咖哩小屋").fill("咖哩小屋");
await shop.getByRole("button", { name: "咖哩屋" }).click();
await shot(shop, "01-shop-new");
await shop.getByRole("button", { name: /開店！/ }).click();
await shop.getByText("開店成功").waitFor();
const manageKey = await shop.locator(".key-box").innerText();
await shot(shop, "02-shop-key");
await shop.getByRole("button", { name: "前往店家後台上架菜單" }).click();
await shop.getByRole("heading", { name: "菜單" }).waitFor();

step("上架咖哩飯並營業");
await shop.getByRole("button", { name: "＋ 新增餐點" }).click();
await shop.getByLabel("餐點名稱").first().fill("咖哩飯");
await shop.getByLabel("價格（新台幣整數）").first().fill("130");
await shop.getByLabel("更換餐點圖片").first().click();
await shop.getByRole("button", { name: "咖哩飯" }).click();
await shop.getByRole("button", { name: "上架" }).click();
await shop.getByText("已上架：咖哩飯").waitFor();
await shop.getByRole("button", { name: "營業中" }).click();
await shop.getByText("開門營業！").waitFor();
await shot(shop, "03-shop-admin");

// 2. 揪團者開團
step("揪團者開團");
await owner.goto(BASE);
await owner.getByLabel(/你的暱稱/).fill("阿凱");
// 用手動設定貼虛構座標：不打外部地址查詢服務，也不依賴瀏覽器定位權限。
await owner.getByText("查不到或位置不對？手動設定位置").click();
await owner.getByLabel("送餐地址座標").fill("24.152, 120.655");
await owner.getByText(/收單時依送餐地址與各店的直線距離/).waitFor();
await owner.getByRole("button", { name: "全選營業中的店" }).click();
await owner.getByRole("button", { name: "開團並取得邀請網址" }).click();
await owner.waitForURL(/\/r\//);
await owner.getByText("人在線").waitFor();
const roomUrl = owner.url();
await shot(owner, "04-owner-street");

// 3. 參與者加入
step("參與者加入");
await guest.goto(roomUrl);
await guest.getByLabel(/暱稱/).fill("小雨");
await guest.getByRole("button", { name: "加入午餐小鎮" }).click();
await guest.getByText("人在線").waitFor();

// 4. 走到咖哩小屋（新店拿到的第一塊空地）門口，再往上走進門
step("參與者走路進店");
await guest.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const hold = async (key, ms) => {
  await guest.keyboard.down(key);
  await guest.waitForTimeout(ms);
  await guest.keyboard.up(key);
};
const state = () => guest.evaluate(() => window.__lunchGame.state());
/** 沿單一軸走到目標座標（容許誤差 tol），卡住超過 1.5 秒就報錯。 */
async function walkAxis(axis, target, tol = 3) {
  let last = await state();
  let stuckSince = Date.now();
  for (;;) {
    const cur = await state();
    const d = target - cur[axis];
    if (Math.abs(d) <= tol) return cur;
    const key = axis === "x" ? (d > 0 ? "ArrowRight" : "ArrowLeft") : d > 0 ? "ArrowDown" : "ArrowUp";
    await hold(key, Math.min(120, Math.max(30, Math.abs(d) * 8)));
    const now = await state();
    if (Math.hypot(now.x - last.x, now.y - last.y) > 0.5) stuckSince = Date.now();
    else if (Date.now() - stuckSince > 1500) throw new Error(`走路卡住：${axis} 往 ${target}，目前 (${now.x.toFixed(0)}, ${now.y.toFixed(0)})`);
    last = now;
  }
}
const lot = await guest.evaluate(async () => {
  const r = await fetch("/api/town");
  const town = await r.json();
  return town.find((l) => l.store?.name === "咖哩小屋").index;
});
const door = await guest.evaluate(
  (i) => fetch(`/api/rooms/${location.pathname.split("/")[2]}/snapshot`).then((r) => r.json()).then((s) => s.catalog.stores.find((st) => st.lotIndex === i).door),
  lot,
);
const doorX = door.x * 960;
const doorY = door.y * 608;
// 先下到南屯路（y≈424）走到門的正下方，再往上走到門口；路上若被擋，改從另一條東西向道路走
await walkAxis("y", 424, 4);
await walkAxis("x", doorX, 2);
await walkAxis("y", doorY + 4, 3);
await guest.getByRole("button", { name: /進入「咖哩小屋」/ }).waitFor({ timeout: 3000 });
await shot(guest, "05-guest-at-door");
await hold("ArrowUp", 400); // 直接走進門，不按 E
await guest.getByRole("button", { name: "咖哩飯 加一份" }).waitFor({ timeout: 3000 });

step("參與者走到陳列台前按 Enter +1");
await hold("ArrowUp", 1200); // 只有一道菜時陳列台在正中間，從出生點往上走就會停在它前面
await guest.getByRole("button", { name: /按 Enter 加一份「咖哩飯」/ }).waitFor({ timeout: 3000 });
await guest.keyboard.press("Enter");
await guest.getByText("已加入：咖哩飯 × 1").waitFor();
await guest.waitForTimeout(400);
await shot(guest, "06-guest-shop-plus1");

// 5. 揪團者即時看到
step("揪團者即時看到彙總");
await owner.getByText("咖哩飯").waitFor({ timeout: 3000 });
await owner.getByText("NT$130").first().waitFor();
await owner.getByRole("button", { name: "阿福便當" }).click();
await owner.getByRole("button", { name: "招牌雞腿飯 加一份" }).click();
await owner.getByText("已加入：招牌雞腿飯 × 1").waitFor();
await owner.getByRole("button", { name: "← 返回街道" }).click();
await owner.getByText("總金額").waitFor();
await owner.getByText("店家未設定外送，預設自取").first().waitFor();
await owner.waitForTimeout(600); // 等進出店淡入淡出結束
await shot(owner, "07-owner-summary");

// 6. 收單與匯出
step("揪團者收單並匯出");
await owner.getByRole("button", { name: "收單並複製明細" }).click();
await owner.getByRole("dialog", { name: "確定收單？" })
  .getByText("店家未設定外送，預設自取").first().waitFor();
await owner.getByRole("button", { name: "收單並送出（未達標的店改自取）" }).click();
await owner.getByRole("dialog", { name: "訂單已送出" }).waitFor();
await owner.getByRole("dialog", { name: "訂單已送出" }).getByText("自取", { exact: true }).first().waitFor();
const exported = await owner.locator("textarea.export-box").inputValue();
console.log("\n" + exported + "\n");
await shot(owner, "08-owner-export");

step("參與者看到已收單、按鈕鎖定");
await guest.getByText("已收單，訂單已鎖定").waitFor({ timeout: 3000 });
const disabled = await guest.locator(".btn.plus").first().isDisabled();
if (!disabled) throw new Error("收單後 +1 仍可按");
await shot(guest, "09-guest-closed");

step("店家即時收到新訂單並接單");
const shopOrders = shop.getByRole("region", { name: "訂單", exact: true });
await shopOrders.getByText("咖哩飯", { exact: true }).waitFor({ timeout: 3000 });
await shopOrders.getByText("自取", { exact: true }).waitFor();
await shot(shop, "10-shop-new-order");
await shopOrders.getByRole("button", { name: "接單", exact: true }).click();
await shopOrders.getByRole("button", { name: "開始製作" }).waitFor();
await shot(shop, "11-shop-accepted");
await guest.getByRole("button", { name: "← 返回街道" }).click();
const roomOrders = guest.getByRole("region", { name: "訂單狀態" });
const curryOrder = roomOrders.locator(".room-store-order").filter({ hasText: "咖哩小屋" });
await curryOrder.getByText("店家已接單", { exact: true }).waitFor({ timeout: 3000 });
await shot(guest, "12-guest-accepted");
await shopOrders.getByRole("button", { name: "開始製作" }).click();
await shopOrders.getByText("製作中", { exact: true }).waitFor();
await shot(shop, "13-shop-preparing");
await curryOrder.getByText("製作中", { exact: true }).waitFor({ timeout: 3000 });
await shot(guest, "14-guest-preparing");
await shopOrders.getByRole("button", { name: "可取餐", exact: true }).click();
await curryOrder.getByText("可取餐", { exact: true }).waitFor({ timeout: 3000 });
await shopOrders.getByText(/今天已完成/).click();
await shot(shop, "15-shop-ready");
await shot(guest, "16-guest-ready");

step("揪團者設定銀行轉帳與 LINE Pay，再傳送收款資訊");
await owner.getByRole("dialog", { name: "訂單已送出" }).getByRole("button", { name: "關閉", exact: true }).click();
await owner.getByRole("button", { name: "收款設定", exact: true }).click();
const paymentSettings = owner.getByRole("dialog", { name: "收款設定" });
await paymentSettings.getByLabel("銀行代碼", { exact: true }).fill("812");
await paymentSettings.getByLabel("帳號", { exact: true }).fill("1234-5678-9012");
await paymentSettings.getByLabel("戶名", { exact: true }).fill("王阿凱");
await paymentSettings.getByRole("button", { name: "新增收款方式" }).click();
await paymentSettings.getByRole("combobox", { name: /^收款方式 2/ }).selectOption("linepay");
await paymentSettings.getByLabel("LINE Pay ID", { exact: true }).fill("akai-lunch");
await paymentSettings.getByLabel("備註", { exact: true }).fill("下午三點前付清");
await shot(owner, "17-owner-payment-settings");
await paymentSettings.getByRole("button", { name: "儲存", exact: true }).click();
await paymentSettings.waitFor({ state: "hidden" });
await owner.getByRole("button", { name: "傳送收款資訊給團員" }).click();
await owner.getByText(/已於 \d{2}:\d{2} 傳送/).waitFor();
const paymentCard = guest.getByRole("region", { name: "付款", exact: true });
await paymentCard.getByText(/你要付 NT\$130/).waitFor({ timeout: 3000 });
await paymentCard.getByText("銀行代碼：812", { exact: true }).waitFor({ timeout: 3000 });
await paymentCard.getByText(/ID：akai-lunch/).waitFor({ timeout: 3000 });
await shot(guest, "18-guest-payment");

step("參與者回報付款，揪團者確認收到");
await paymentCard.getByRole("button", { name: "我已付款", exact: true }).click();
await paymentCard.getByText("已回報付款，等待團主確認", { exact: true }).waitFor();
await owner.getByRole("tab", { name: "每人明細", exact: true }).click();
const people = owner.getByRole("region", { name: "每人明細", exact: true });
const reportedPerson = people.locator(".card").filter({ hasText: "已回報付款" });
await reportedPerson.getByText("已回報付款", { exact: true }).waitFor({ timeout: 3000 });
await shot(owner, "19-owner-payment-reported");
await reportedPerson.getByRole("button", { name: "確認收到", exact: true }).click();
await paymentCard.getByText("✓ 團主已確認收到", { exact: true }).waitFor({ timeout: 3000 });
await people.getByText("已確認收到", { exact: true }).waitFor();
await shot(owner, "20-owner-payment-confirmed");
await shot(guest, "21-guest-payment-confirmed");

step(`完成（管理碼 ${manageKey}）`);
await browser.close();
