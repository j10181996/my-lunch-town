// 本機限定：兩個獨立瀏覽器，包含具真實觸控事件的手機模擬。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const base = process.argv[2] ?? "http://127.0.0.1:5178";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const out = process.argv[3] ?? "/tmp/lunch-town-55-shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const outsider = await browser.newContext();
  const owner = await a.newPage(), guest = await b.newPage();
  for (const p of [owner, guest]) p.on("pageerror", (e) => errors.push(e.message));
  const createdResponse = await a.request.post(base + "/api/rooms", { data: { title: "台中午休冒險團", nickname: "台中團長", requestId: crypto.randomUUID(), storeIds: ["store-af", "store-tree", "store-green"] } });
  assert.equal(createdResponse.status(), 200);
  const { snapshot: initial, invitePath } = await createdResponse.json();
  const root = `/api/rooms/${initial.room.id}`;
  await owner.goto(base + invitePath);
  await guest.goto(base + invitePath);
  await guest.getByLabel(/暱稱/).fill("午休夥伴");
  await guest.getByRole("button", { name: "加入午餐小鎮" }).tap();
  const panel = (p) => p.getByRole("region", { name: "全團選餐進度" });
  await panel(owner).getByText("已有 0／2 人選好午餐").waitFor();
  assert(await panel(guest).getByRole("button", { name: "我選好了！", exact: true }).isDisabled());
  assert.equal((await outsider.request.put(base + root + "/lunch-ready", { data: { ready: true } })).status(), 401);
  console.log("✓ 雙人加入、初始進度、未點餐禁用、非團員拒絕");

  await owner.getByRole("button", { name: /新手任務/ }).click();
  await owner.getByRole("button", { name: "帶我逛店" }).click();
  await owner.getByRole("button", { name: /新手任務/ }).click();
  await owner.getByRole("region", { name: "新手任務" }).getByText("✓ 逛一家店", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "收起任務" }).click();
  const meal = initial.catalog.meals.find((m) => m.storeId === initial.catalog.stores[0].id && m.available);
  await owner.getByRole("button", { name: meal.name + " 加一份", exact: true }).first().click();
  await owner.getByRole("button", { name: /新手任務/ }).click();
  await owner.getByRole("region", { name: "新手任務" }).getByText("✓ 選一份午餐", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "回街上找動物" }).click();
  const state = () => owner.evaluate(() => window.__lunchGame.state());
  async function walk(axis, target) {
    for (let i = 0; i < 50; i++) {
      const d = target - (await state())[axis]; if (Math.abs(d) < 4) return;
      const key = axis === "x" ? d > 0 ? "ArrowRight" : "ArrowLeft" : d > 0 ? "ArrowDown" : "ArrowUp";
      await owner.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await owner.keyboard.down(key); await owner.waitForTimeout(Math.max(35, Math.min(100, Math.abs(d) * 10))); await owner.keyboard.up(key);
    }
    throw Error("Walk stuck: " + JSON.stringify(await state()));
  }
  // 先回到開放廣場，再跟隨散步的貓。
  await walk("y", 350); await walk("x", 504);
  for (let i = 0; i < 10; i++) {
    const current = await state(); if (current.nearFriend) break;
    const cat = current.friends.find((f) => f.name === "橘子").pose;
    await walk("x", cat.x); await walk("y", cat.y);
  }
  await owner.getByRole("button", { name: /摸摸/ }).click();
  await owner.getByRole("button", { name: /午休冒險完成/ }).waitFor();
  await owner.getByRole("button", { name: /午休冒險完成/ }).click();
  await owner.screenshot({ path: out + "/01-quests.png" });
  await owner.getByRole("button", { name: "收起任務" }).click();
  console.log("✓ 引導進店、真實點餐與摸動物完成三項任務");

  await panel(owner).getByRole("button", { name: "我選好了！", exact: true }).click();
  await panel(guest).getByText("已有 1／2 人選好午餐").waitFor();
  await guest.reload();
  await panel(guest).getByText("已有 1／2 人選好午餐").waitFor();
  await guest.getByRole("button", { name: /新手任務/ }).tap();
  await guest.getByRole("button", { name: "帶我點餐" }).tap();
  await guest.getByRole("button", { name: meal.name + " 加一份", exact: true }).first().tap();
  await panel(guest).getByRole("button", { name: "我選好了！", exact: true }).tap();
  const dialog = (p) => p.getByRole("dialog", { name: "大家都選好了！一起留張合照" });
  await dialog(owner).waitFor(); await dialog(guest).waitFor();
  assert(await guest.getByRole("button", { name: /角色移動搖桿/ }).isDisabled());
  const image = dialog(owner).getByRole("img");
  assert((await image.getAttribute("src")).startsWith("data:image/png;base64,"));
  const dl = owner.waitForEvent("download");
  await dialog(owner).getByRole("link", { name: "下載合照 PNG" }).click();
  const download = await dl; await download.saveAs(out + "/group-photo.png");
  await owner.screenshot({ path: out + "/02-desktop-celebration.png" });
  await guest.screenshot({ path: out + "/03-mobile-celebration.png" });
  const layout = await guest.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(layout.scroll <= layout.width, "手機不能橫向溢出");
  console.log("✓ 雙人同步慶祝、手機搖桿暫停、PNG 下載與手機無橫向溢出");
  for (const p of [owner, guest]) await dialog(p).getByRole("button", { name: "繼續逛小鎮" }).click();
  await owner.reload(); await panel(owner).getByText("已有 2／2 人選好午餐").waitFor();
  assert.equal(await dialog(owner).count(), 0, "重整不可重播慶祝");
  await owner.getByRole("button", { name: /午休冒險完成/ }).waitFor();
  await panel(owner).getByRole("button", { name: /點此取消/ }).click();
  await panel(guest).getByText("已有 1／2 人選好午餐").waitFor();
  // 成功改餐會取消自己的完成狀態。
  await guest.getByRole("button", { name: meal.name + " 加一份", exact: true }).first().tap();
  await panel(owner).getByText("已有 0／2 人選好午餐").waitFor();
  await panel(owner).getByRole("button", { name: "我選好了！", exact: true }).click();
  await panel(guest).getByRole("button", { name: "我選好了！", exact: true }).tap();
  await dialog(owner).waitFor(); await dialog(guest).waitFor();
  for (const p of [owner, guest]) await dialog(p).getByRole("button", { name: "繼續逛小鎮" }).click();
  const snapshot = await (await a.request.get(base + root + "/snapshot")).json();
  assert.equal(snapshot.lunchParty.celebration.id, 2);
  assert.equal(snapshot.room.status, "open"); assert.equal(snapshot.storeOrders.length, 0);
  const joined = await outsider.request.post(base + root + "/join", { data: { nickname: "剛到的朋友", avatarId: "avatar-yellow" } });
  assert.equal(joined.status(), 200);
  await panel(owner).getByText("已有 2／3 人選好午餐").waitFor();
  const late = await outsider.newPage(); late.on("pageerror", (e) => errors.push(e.message));
  await late.goto(base + invitePath);
  await panel(late).getByText("已有 2／3 人選好午餐").waitFor();
  assert.equal(await dialog(late).count(), 0, "新團員不可自動播放先前合照");
  await panel(owner).getByRole("button", { name: /查看最近一次全團合照/ }).click();
  await dialog(owner).getByRole("img", { name: /共 2 位夥伴/ }).waitFor();
  await dialog(owner).getByRole("button", { name: "繼續逛小鎮" }).click();
  console.log("✓ 重整不重播、取消與改餐重置、再次完成、新成員計入、舊合照保留、不自動收單");
  for (const context of [a, b]) assert.equal((await context.request.put(base + root + "/lunch-ready", { data: { ready: false } })).status(), 200);
  assert.equal((await outsider.request.post(base + root + "/order-delta", { data: { mealId: meal.id, delta: 1, requestId: crypto.randomUUID() } })).status(), 200);
  const confirmations = await Promise.all([a, b, outsider].map((context) => context.request.put(base + root + "/lunch-ready", { data: { ready: true } })));
  for (const r of confirmations) assert.equal(r.status(), 200);
  const concurrent = await (await a.request.get(base + root + "/snapshot")).json();
  assert.equal(concurrent.lunchParty.readyMemberIds.length, 3);
  assert.equal(concurrent.lunchParty.celebration.id, 3, "同時確認只產生一次慶祝");
  assert.equal(concurrent.lunchParty.celebration.members.length, 3);
  console.log("✓ 三人並行確認不漏狀態、不重複慶祝");
  await dialog(guest).waitFor();
  await dialog(guest).getByRole("button", { name: "繼續逛小鎮" }).click();
  for (const size of [{ width: 320, height: 720 }, { width: 360, height: 800 }, { width: 844, height: 390 }]) {
    await guest.setViewportSize(size);
    const quest = await guest.locator(".quest-toggle").boundingBox();
    const emotes = await guest.locator(".emote-bar").boundingBox();
    assert(quest.x + quest.width <= emotes.x || quest.y + quest.height <= emotes.y, "新手任務與表情按鈕不可重疊");
    assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "窄版與橫向不可溢出");
    await guest.getByRole("button", { name: /新手任務/ }).tap();
    const steps = guest.getByRole("region", { name: "新手任務" });
    await steps.getByRole("button", { name: "收起任務" }).tap();
  }
  console.log("✓ 320／360px 窄版與手機橫向任務可操作、控制列不重疊");
  assert.deepEqual(errors, []);
  console.log("✓ 無 pageerror");
} finally { await browser.close(); }
