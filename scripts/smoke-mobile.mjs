// 本機限定。以 CDP 送真正的 TouchEvent／PointerEvent，不用鍵盤或修改遊戲狀態。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const base = process.argv[2] ?? "http://127.0.0.1:5178";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only run locally");
const out = process.argv[3] ?? "/tmp/lunch-town-18-shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const profile of [{ name: "iphone-size", width: 390, height: 844, dpr: 3 }, { name: "android-size", width: 412, height: 915, dpr: 2.625 }]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const town = await (await context.request.get(base + "/api/town")).json();
    const storeIds = town.flatMap((lot) => (lot.store?.status === "open" ? [lot.store.id] : []));
    const createdResponse = await context.request.post(base + "/api/rooms", { data: { title: "手機點餐測試", nickname: "手機團長", requestId: crypto.randomUUID(), storeIds } });
    assert.equal(createdResponse.status(), 200);
    const created = await createdResponse.json(), root = `/api/rooms/${created.snapshot.room.id}`;
    await page.goto(base + created.invitePath);
    await page.waitForFunction(() => !!window.__lunchGame);
    const stick = page.getByRole("button", { name: /角色移動搖桿/ });
    await stick.waitFor();
    const cdp = await context.newCDPSession(page);
    const state = () => page.evaluate(() => window.__lunchGame.state());
    const snap = async () => (await context.request.get(base + root + "/snapshot")).json();
    const point = async () => { const r = await stick.boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 0 }; };
    const touch = (type, points = []) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    async function drag(dx, dy, ms, end = "touchEnd") {
      const p = await point();
      await touch("touchStart", [p]);
      await touch("touchMove", [{ ...p, x: p.x + dx, y: p.y + dy }]);
      await page.waitForTimeout(ms);
      if (end) await touch(end);
    }
    const start = await state();
    await drag(70, 0, 400);
    const moved = await state();
    assert(moved.x > start.x + 20, "拖動搖桿必須移動角色");
    await page.waitForTimeout(250);
    assert(Math.abs((await state()).x - moved.x) < 2, "放開必須停止");
    await drag(-180, 0, 400, "touchCancel");
    const cancelled = await state();
    await page.waitForTimeout(250);
    assert(Math.abs((await state()).x - cancelled.x) < 2, "觸控取消必須停止，即使手指在搖桿外");
    assert.equal(await page.evaluate(() => scrollY), 0, "搖桿不可捲動頁面");
    const beforeDeadZone = await state();
    await drag(3, 3, 250);
    assert(Math.hypot((await state()).x - beforeDeadZone.x, (await state()).y - beforeDeadZone.y) < 2, "中心死區不能漂移");
    await drag(35, 0, 150, null);
    await page.evaluate(() => dispatchEvent(new Event("blur")));
    const blurred = await state();
    await touch("touchEnd"); await page.waitForTimeout(200);
    assert(Math.abs((await state()).x - blurred.x) < 2, "失焦必須停止");
    console.log(`✓ ${profile.name}: 真觸控拖動、放開、拖出範圍、cancel、失焦與死區`);

    await page.getByRole("button", { name: "邀請朋友", exact: true }).tap();
    assert(await stick.isDisabled(), "彈窗時搖桿必須停用");
    await page.getByRole("dialog", { name: "邀請朋友加入" }).getByRole("button", { name: "關閉", exact: true }).tap();
    assert(await stick.isEnabled());
    await page.getByRole("button", { name: /收合菜單，放大街景/ }).tap();
    assert.equal(await page.locator("#room-order-panel").isVisible(), false);
    const collapsedHeight = (await page.locator(".stage").boundingBox()).height;
    await page.getByRole("button", { name: /展開菜單與訂單/ }).tap();
    assert((await page.locator(".stage").boundingBox()).height < collapsedHeight);

    const store = created.snapshot.catalog.stores.find((s) => s.lotIndex === 0) ?? created.snapshot.catalog.stores[0];
    async function walkTouch(axis, target, expectedScene = "street") {
      for (let i = 0; i < 60; i++) {
        const current = await state();
        if (current.scene !== expectedScene) return;
        const delta = target - current[axis];
        if (Math.abs(delta) < 5) return;
        const direction = Math.sign(delta) * 65;
        await drag(axis === "x" ? direction : 0, axis === "y" ? direction : 0, Math.min(180, Math.max(80, Math.abs(delta) / 84 * 1000)));
      }
      throw new Error("搖桿導航卡住：" + JSON.stringify(await state()));
    }
    await walkTouch("y", 360);
    await walkTouch("x", store.door.x * 960);
    // 導航允許 5px 誤差，目標要深入門框，才不會在自動進店門檻外提早停止。
    await walkTouch("y", store.door.y * 608 - 6);
    await page.waitForFunction((scene) => window.__lunchGame.state().scene === scene, store.sceneId);
    await page.waitForTimeout(500);
    const fixed = await state();
    await page.waitForTimeout(200);
    assert.equal((await state()).y, fixed.y, "換場後不應繼續行走");
    // 依 canvas 真實邊界與讀取用商品位置找餐點，不直接呼叫遊戲或訂單函式。
    const product = await page.evaluate(() => window.__lunchGame.products()[0]);
    assert(product);
    const canvas = await page.locator("canvas.game-canvas").boundingBox();
    const px = canvas.x + product.x / 384 * canvas.width;
    const py = canvas.y + (product.y + 8) / 216 * canvas.height;
    await page.touchscreen.tap(px, py);
    await page.waitForFunction(async () => (await (await fetch(location.pathname.replace("/r/", "/api/rooms/") + "/snapshot")).json()).myTotalQuantity === 1);
    await page.waitForTimeout(200);
    assert.equal((await snap()).myTotalQuantity, 1, "一次點選不能重複加餐");
    const movedTap = { x: px, y: py, id: 0 };
    await touch("touchStart", [movedTap]);
    await touch("touchMove", [{ ...movedTap, x: px + 24 }]);
    await touch("touchEnd"); await page.waitForTimeout(250);
    assert.equal((await snap()).myTotalQuantity, 1, "滑過餐點不能誤下單");
    await page.screenshot({ path: `${out}/${profile.name}-shop.png` });
    console.log(`✓ ${profile.name}: 可收合面板、搖桿走路進店、直接點餐且拖曳不誤下單`);

    // 放大街景後用搖桿走向陳列台，確認碰撞仍有效，接近後的點餐按鈕亦可觸控。
    await page.getByRole("button", { name: /收合菜單，放大街景/ }).tap();
    if (product.zone.y < 160) {
      await walkTouch("y", product.zone.y + 8, store.sceneId);
      await walkTouch("x", product.x, store.sceneId);
    } else {
      await walkTouch("x", product.x, store.sceneId);
      await walkTouch("y", product.zone.y + 8, store.sceneId);
    }
    await drag(0, -65, 500);
    const atCounter = await state();
    assert(atCounter.y < fixed.y && atCounter.y > 140, "角色必須走向陳列台且不能穿過它");
    await page.getByRole("button", { name: /加一份「/ }).tap();
    await page.waitForFunction(async () => (await (await fetch(location.pathname.replace("/r/", "/api/rooms/") + "/snapshot")).json()).myTotalQuantity === 2);
    await page.getByRole("button", { name: "← 返回街道", exact: true }).tap();
    await page.waitForFunction(() => window.__lunchGame.state().scene === "street");
    await page.setViewportSize({ width: profile.height, height: profile.width });
    await stick.waitFor();
    const landscape = await state();
    await page.waitForTimeout(200);
    assert(Math.hypot((await state()).x - landscape.x, (await state()).y - landscape.y) < 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${profile.name}-landscape.png` });
    console.log(`✓ ${profile.name}: 搖桿進店內走動、碰撞、觸控加餐、返回與橫向版面`);

    // 收單後直接點陳列台不會新增訂單。
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.getByRole("button", { name: /展開菜單與訂單/ }).tap();
    await page.getByRole("button", { name: store.name, exact: true }).tap();
    await context.request.post(base + root + "/close", { data: { requestId: crypto.randomUUID() } });
    await page.getByText("已收單，訂單已鎖定").waitFor();
    const closedCanvas = await page.locator("canvas.game-canvas").boundingBox();
    await page.touchscreen.tap(closedCanvas.x + product.x / 384 * closedCanvas.width, closedCanvas.y + (product.y + 8) / 216 * closedCanvas.height);
    assert.equal((await snap()).myTotalQuantity, 2);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Mobile touch smoke passed: " + base);
} finally { await browser.close(); }
