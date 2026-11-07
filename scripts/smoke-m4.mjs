// 本機限定：雙瀏覽器驗證表情、隱私開關、NPC、收藏、換裝、點餐與重整。
// 先啟動 Node + Vite，或 Sites 本機 Wrangler，再傳入對應網址。
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:5178";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only run fixtures locally");
const out = process.argv[3] ?? "/tmp/lunch-town-m4-shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const b = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const owner = await a.newPage(), guest = await b.newPage();
  for (const page of [owner, guest]) page.on("pageerror", (e) => errors.push(e.message));
  await owner.goto(base);
  await owner.getByLabel(/你的暱稱/).fill("摸貓團長");
  await owner.getByRole("button", { name: "開團並取得邀請網址" }).click();
  await owner.waitForURL(/\/r\//);
  const roomUrl = owner.url(), root = `/api/rooms/${new URL(roomUrl).pathname.split("/")[2]}`;
  await guest.goto(roomUrl);
  await guest.getByLabel(/暱稱/).fill("揮手夥伴");
  await guest.getByRole("button", { name: "加入午餐小鎮" }).click();
  await owner.waitForFunction(() => window.__lunchGame?.state().remotes.length === 1);
  await guest.waitForFunction(() => window.__lunchGame?.state().remotes.length === 1);
  const snap = await (await a.request.get(base + root + "/snapshot")).json();
  const joined = await (await b.request.get(base + root + "/snapshot")).json();
  await guest.getByRole("button", { name: "揮揮手", exact: true }).click();
  await owner.waitForFunction((id) => window.__lunchGame.state().bubbles.some(([member, bub]) => member === id && bub.text.includes("👋")), joined.me.id);
  console.log("✓ 跨瀏覽器表情同步");

  const state = () => owner.evaluate(() => window.__lunchGame.state());
  const hold = async (key, ms) => {
    await owner.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await owner.keyboard.down(key); await owner.waitForTimeout(ms); await owner.keyboard.up(key);
  };
  async function walk(axis, target) {
    for (let i = 0; i < 45; i++) {
      const cur = await state(), d = target - cur[axis];
      if (Math.abs(d) < 4) return;
      await hold(axis === "x" ? d > 0 ? "ArrowRight" : "ArrowLeft" : d > 0 ? "ArrowDown" : "ArrowUp", Math.max(35, Math.min(100, Math.abs(d) * 10)));
    }
    throw new Error("Walking stuck: " + JSON.stringify(await state()));
  }
  // 跟隨出生點附近的橘貓，使用實際鍵盤移動，不直接修改遊戲狀態。
  for (let i = 0; i < 8; i++) {
    const cur = await state();
    if (cur.nearFriend === "橘子") break;
    const cat = cur.friends.find((f) => f.name === "橘子").pose;
    await walk("x", cat.x); await walk("y", cat.y);
  }
  await owner.getByRole("button", { name: /摸摸/ }).waitFor();
  await owner.keyboard.press("Enter");
  await owner.waitForFunction(() => window.__lunchGame.state().bubbles.some(([id, bub]) => id.startsWith("friend-") && bub.text.includes("蹭")));
  console.log("✓ 鍵盤摸摸動物與愛心回饋");

  const item = (await state()).items.find((item) => item.id.endsWith(":0"));
  if (item) { await walk("x", item.x); await walk("y", item.y); }
  await owner.getByRole("button", { name: "背包與小鎮設定" }).click();
  const bag = owner.getByRole("region", { name: "背包與小鎮設定" });
  await bag.getByText(/今日小物 [1-5] \/ 5/).waitFor();
  await bag.getByRole("button", { name: "🌼 小花髮飾" }).click();
  await guest.waitForFunction((id) => window.__lunchGame.state().remotes.some((r) => r.id === id && r.accessory === "flower"), snap.me.id);
  await owner.screenshot({ path: out + "/01-town-collection.png" });
  console.log("✓ 自動撿拾、背包與跨瀏覽器換裝");
  await bag.getByLabel("顯示村民與小動物").uncheck();
  await owner.waitForFunction(() => window.__lunchGame.state().friends.length === 0);
  await bag.getByLabel("顯示村民與小動物").check();
  await owner.waitForFunction(() => window.__lunchGame.state().friends.length === 6);
  await bag.getByLabel("社交表情與點餐泡泡").uncheck();
  await owner.waitForFunction(async () => !(await (await fetch(location.pathname.replace("/r/", "/api/rooms/") + "/snapshot")).json()).socialEnabled);
  const meal = snap.catalog.meals.find((m) => m.available);
  assert.equal((await a.request.post(base + root + "/emote", { data: { emote: "heart" } })).status(), 403);
  assert.equal((await a.request.post(base + root + "/order-delta", { data: { mealId: meal.id, delta: 1, requestId: crypto.randomUUID() } })).status(), 200);
  await guest.waitForTimeout(600);
  assert(!(await guest.evaluate(() => window.__lunchGame.state().bubbles)).some(([id, bub]) => id === snap.me.id && bub.text.includes("+1")));
  console.log("✓ 關閉社交後，成功點餐且不廣播餐點泡泡");
  await bag.getByLabel("社交表情與點餐泡泡").check();
  await bag.getByRole("button", { name: "關閉背包" }).click();
  // 使用既有側欄入口進店，再驗證同店名單。
  await owner.getByRole("button", { name: snap.catalog.stores[0].name, exact: true }).click();
  await guest.getByRole("button", { name: snap.catalog.stores[0].name, exact: true }).click();
  await owner.getByText("一起逛店：揮手夥伴", { exact: true }).waitFor();
  assert.equal((await state()).friends.length, 0, "NPC 不會出現在店內");
  assert.equal((await state()).nearFriend, null, "店內不出現摸摸提示");
  await owner.getByRole("button", { name: "背包與小鎮設定" }).click();
  await bag.getByText(/小鎮成就 [3-4] \/ 4/).waitFor();
  await owner.screenshot({ path: out + "/02-shop-company.png" });
  console.log("✓ 進店、同店名單與進店／點餐／摸動物成就");
  await owner.reload();
  await owner.getByRole("button", { name: "背包與小鎮設定" }).click();
  assert.equal(await bag.getByRole("button", { name: "🌼 小花髮飾" }).getAttribute("aria-pressed"), "true");
  await bag.getByText(/今日小物 [1-5] \/ 5/).waitFor();
  await bag.getByLabel("顯示成就徽章").uncheck();
  await guest.waitForFunction((id) => window.__lunchGame.state().remotes.some((r) => r.id === id && !r.badge), snap.me.id);
  await owner.setViewportSize({ width: 390, height: 844 });
  const stageBox = await owner.locator(".stage").boundingBox(), bagBox = await bag.boundingBox();
  assert(bagBox.y + bagBox.height <= stageBox.y + stageBox.height, "背包必須在街景範圍內捲動，不可被裁切");
  await bag.getByLabel("顯示村民與小動物").scrollIntoViewIfNeeded();
  await owner.screenshot({ path: out + "/03-mobile-bag.png" });
  assert(await bag.getByRole("button", { name: "關閉背包" }).isVisible());
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await bag.getByRole("button", { name: "關閉背包" }).click();
  await owner.waitForFunction(() => window.__lunchGame.state().friends.length === 3);
  const fps = await owner.evaluate(() => new Promise((resolve) => {
    const start = performance.now(); let count = 0;
    const sample = () => { count++; const elapsed = performance.now() - start; if (elapsed >= 1500) resolve(count * 1000 / elapsed); else requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  }));
  assert(fps >= 30, `窄螢幕動畫未達 30fps：${fps}`);
  console.log(`✓ 重整保留收藏／造型、徽章隱藏、窄螢幕減量與版面（本機 ${fps.toFixed(0)}fps）`);
  assert.deepEqual(errors, []);
  console.log("M4 smoke passed: " + base);
} finally { await browser.close(); }
