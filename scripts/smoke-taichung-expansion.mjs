// 本機限定：十四家開團、八家新店點餐與地址、桌面／手機同步及新店走路進店。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { LOTS, STREET_W, STREET_H } from "../shared/town.ts";
import { streetLayout, overlaps } from "../web/art/street-layout.ts";
const base = process.argv[2] ?? "http://127.0.0.1:5178";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const out = process.argv[3] ?? "/tmp/lunch-town-67-shots"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await a.newPage(), phone = await b.newPage();
  for (const p of [page, phone]) p.on("pageerror", (e) => errors.push(e.message));
  const town = await (await a.request.get(base + "/api/town")).json();
  assert.equal(town.length, 20); const stores = town.flatMap((l) => l.store ? [{ ...l.store, lotIndex: l.index }] : []);
  assert.equal(stores.length, 14); const added = stores.filter((s) => s.lotIndex >= 12); assert.equal(added.length, 8);
  await page.goto(base);
  await page.getByLabel(/你的暱稱/).fill("台中團長");
  await page.getByRole("button", { name: "全選營業中的店" }).click();
  await page.getByRole("button", { name: "開團並取得邀請網址" }).click();
  await page.waitForURL(/\/r\//);
  const root = `/api/rooms/${new URL(page.url()).pathname.split("/")[2]}`;
  await phone.goto(page.url()); await phone.getByLabel(/暱稱/).fill("手機夥伴");
  await phone.getByRole("button", { name: "加入午餐小鎮" }).tap();
  const snapshot = await (await a.request.get(base + root + "/snapshot")).json();
  assert.equal(snapshot.catalog.stores.length, 14); assert.equal(snapshot.catalog.meals.length, 145);
  console.log("✓ 首頁全選十四家開團、二十格街區與手機加入");
  for (const [i, store] of added.entries()) {
    await page.getByRole("button", { name: store.name, exact: true }).click();
    const menu = page.getByRole("region", { name: store.name + " 菜單" });
    await menu.getByText(store.address, { exact: false }).waitFor();
    const meal = snapshot.catalog.meals.find((m) => m.storeId === store.id);
    await menu.getByRole("button", { name: meal.name + " 加一份", exact: true }).click();
    await page.waitForFunction(async ({ root, quantity }) => (await (await fetch(root + "/snapshot")).json()).myTotalQuantity === quantity, { root, quantity: i + 1 });
    await page.getByRole("button", { name: "← 返回街道", exact: true }).click();
  }
  await phone.waitForFunction(async (root) => (await (await fetch(root + "/snapshot")).json()).totalQuantity === 8, root);
  await phone.getByText("沐浠輕南洋餐盒", { exact: true }).first().waitFor();
  await phone.getByRole("button", { name: "沐浠輕南洋餐盒", exact: true }).tap();
  const menu = phone.getByRole("region", { name: "沐浠輕南洋餐盒 菜單" });
  await menu.getByText(/忠明南路777巷1號/).waitFor();
  await menu.getByRole("button", { name: "香料炙烤雞胸 加一份", exact: true }).tap();
  await phone.waitForFunction(async (root) => (await (await fetch(root + "/snapshot")).json()).myTotalQuantity === 1, root);
  await phone.screenshot({ path: out + "/01-mobile-new-store.png" });
  await phone.getByRole("button", { name: "← 返回街道", exact: true }).tap();
  console.log("✓ 八家新店逐一進店、地址顯示與點餐、手機新店觸控加餐及同步");

  const target = stores.find((s) => s.id === "store-meetzen"), lot = LOTS[target.lotIndex];
  const state = () => page.evaluate(() => window.__lunchGame.state());
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(220); await page.keyboard.up("ArrowDown");
  const start = await state(); const width = STREET_W / 4;
  const colliders = streetLayout().colliders;
  const blocked = (x, y) => x < 8 || x > STREET_W - 8 || y < 8 || y >= STREET_H - 4 ||
    colliders.some((r) => overlaps({ x: x - 6, y: y - 6, w: 12, h: 6 }, r)) ||
    LOTS.some((l) => l.index !== lot.index && Math.abs(x - l.bx - 48) < 22 && y >= l.by + 64 && y < l.by + 86);
  const begin = Math.round(start.y / 4) * width + Math.round(start.x / 4), end = (lot.by + 76) / 4 * width + (lot.bx + 48) / 4;
  const prev = new Map([[begin, begin]]), queue = [begin];
  for (let i = 0; i < queue.length && !prev.has(end); i++) {
    const id = queue[i], x = id % width, y = Math.floor(id / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + dy) * width + x + dx;
      if (prev.has(n) || blocked((x + dx) * 4, (y + dy) * 4)) continue;
      prev.set(n, id); queue.push(n);
    }
  }
  assert(prev.has(end), "新增店家需有實際行走路徑");
  const path = []; for (let id = end; id !== begin; id = prev.get(id)) path.push([id % width * 4, Math.floor(id / width) * 4]);
  path.push([begin % width * 4, Math.floor(begin / width) * 4]); path.reverse();
  const turns = path.filter((p, i) => i === path.length - 1 || i > 0 && (p[0] - path[i - 1][0]) * (path[i + 1][1] - p[1]) !== (p[1] - path[i - 1][1]) * (path[i + 1][0] - p[0]));
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  for (const [x, y] of turns) for (const [axis, dest] of [["x", x], ["y", y]]) {
    for (let i = 0; i < 40; i++) {
      const s = await state(); if (s.scene !== "street") break;
      const d = dest - s[axis]; if (Math.abs(d) < 3) break;
      const key = axis === "x" ? d > 0 ? "ArrowRight" : "ArrowLeft" : d > 0 ? "ArrowDown" : "ArrowUp";
      await page.keyboard.down(key); await page.waitForTimeout(Math.max(30, Math.min(120, Math.abs(d) * 8))); await page.keyboard.up(key);
      if (i === 39) throw Error("角色卡住：" + JSON.stringify(await state()));
    }
  }
  if ((await state()).scene === "street") await page.keyboard.press("e");
  await page.waitForFunction((id) => window.__lunchGame.state().scene === `shop:${id}`, target.id);
  await page.screenshot({ path: out + "/02-walk-to-meetzen.png" });
  console.log("✓ 實際鍵盤跨街區走進新增覓蠶店");
  const walk = await a.newPage(); walk.on("pageerror", (e) => errors.push(e.message));
  await walk.goto(base + "/town");
  await walk.getByRole("button", { name: "有飯食光", exact: true }).click();
  await walk.getByRole("region", { name: "有飯食光 菜單" }).getByText(/公正路130-1號/).waitFor();
  assert.equal(await walk.getByRole("button", { name: /加一份/ }).count(), 0);
  await walk.getByRole("button", { name: "用「有飯食光」開團", exact: true }).click();
  await walk.waitForURL(/from=store-youfan/);
  assert(await walk.getByRole("checkbox", { name: "有飯食光", exact: true }).isChecked());
  assert.deepEqual(errors, []); console.log("✓ 散步模式新店／地址／唯讀菜單與帶店家開團，無 pageerror");
} finally { await browser.close(); }
