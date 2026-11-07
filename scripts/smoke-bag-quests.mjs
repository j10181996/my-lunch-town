// 本機限定：任務傳送回歸、鍵盤／真觸控移動與獨立背包版面。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const base = process.argv[2] ?? "http://127.0.0.1:5178";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const out = process.argv[3] ?? "/tmp/lunch-town-76-shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 960 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const town = await (await context.request.get(base + "/api/town")).json();
    const storeIds = town.flatMap((lot) => lot.store?.status === "open" ? [lot.store.id] : []);
    const response = await context.request.post(base + "/api/rooms", { data: {
      title: "背包任務回歸", nickname: "午休測試", storeIds, requestId: crypto.randomUUID(),
    } });
    assert.equal(response.status(), 200);
    const created = await response.json();
    await page.goto(base + created.invitePath);
    await page.waitForFunction(() => !!window.__lunchGame);
    const state = () => page.evaluate(() => window.__lunchGame.state());
    const click = (locator) => mobile ? locator.tap() : locator.click();
    const quest = page.getByRole("button", { name: /新手任務/ });
    const bagToggle = page.getByRole("button", { name: "背包與小鎮設定", exact: true });
    const bag = page.getByRole("region", { name: "背包與小鎮設定" });
    const cdp = mobile ? await context.newCDPSession(page) : null;
    async function move(dx, dy) {
      if (cdp) {
        const box = await page.getByRole("button", { name: /角色移動搖桿/ }).boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: point.x + dx * 55, y: point.y + dy * 55 }] });
        await page.waitForTimeout(180);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        const key = dx ? dx > 0 ? "ArrowRight" : "ArrowLeft" : dy > 0 ? "ArrowDown" : "ArrowUp";
        await page.keyboard.down(key); await page.waitForTimeout(180); await page.keyboard.up(key);
      }
    }
    async function guide(name) { await click(quest); await click(page.getByRole("button", { name, exact: true })); }
    // 原 bug：街上先按找動物會傳到 (480,279.6)，落進建築後四向都無法移動。
    const start = await state();
    await guide("回街上找動物");
    let current = await state();
    assert.equal(current.scene, "street");
    assert.equal(current.x, start.x); assert.equal(current.y, start.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const before = await state(); await move(dx, dy); current = await state();
      assert((current.x - before.x) * dx + (current.y - before.y) * dy > 5, "找動物後四向都可移動");
    }
    await guide("帶我逛店");
    assert((await state()).scene.startsWith("shop:"));
    let before = await state(); await move(1, 0);
    assert((await state()).x > before.x + 5, "逛店導引後可移動");
    await guide("回街上找動物");
    before = await state(); assert.equal(before.scene, "street"); await move(0, 1);
    assert((await state()).y > before.y + 5, "從店內找動物後可走離門口");
    before = await state(); await guide("回街上找動物"); current = await state();
    assert.equal(current.x, before.x); assert.equal(current.y, before.y);
    await guide("帶我點餐");
    before = await state(); assert(before.scene.startsWith("shop:")); await move(-1, 0);
    assert((await state()).x < before.x - 5, "點餐導引後可移動");
    const store = created.snapshot.catalog.stores.find((s) => s.sceneId === before.scene);
    const meal = created.snapshot.catalog.meals.find((m) => m.storeId === store.id && m.available);
    await click(page.getByRole("button", { name: meal.name + " 加一份", exact: true }).first());
    await page.waitForFunction(() => !!document.querySelector('.lunch-party button:not(:disabled)'));
    console.log(`✓ ${mobile ? "手機搖桿" : "桌面鍵盤"}：街上找動物保留位置、四向移動、進店／出店／點餐導引`);

    assert.equal(await page.getByRole("group", { name: "小鎮表情", exact: true }).getByRole("button").count(), 4);
    assert.equal(await bagToggle.locator("xpath=ancestor::*[@role='group']").count(), 0);
    assert(await bagToggle.getByText("🎒 我的背包", { exact: true }).isVisible());
    await click(quest); await click(bagToggle);
    assert.equal(await quest.getAttribute("aria-expanded"), "false");
    await bag.waitFor();
    await bag.getByLabel("顯示成就徽章").scrollIntoViewIfNeeded();
    let stageBox = await page.locator(".stage").boundingBox(), bagBox = await bag.boundingBox();
    assert(bagBox.y + bagBox.height <= stageBox.y + stageBox.height + 1, "背包在街景內捲動");
    await click(quest); assert.equal(await bag.count(), 0);
    await click(bagToggle);
    await page.screenshot({ path: `${out}/${mobile ? "mobile" : "desktop"}-bag.png` });
    await click(bag.getByRole("button", { name: "關閉背包" }));
    if (mobile) {
      for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        await click(bagToggle);
        stageBox = await page.locator(".stage").boundingBox(); bagBox = await bag.boundingBox();
        assert(bagBox.y + bagBox.height <= stageBox.y + stageBox.height + 1);
        await bag.getByLabel("顯示成就徽章").scrollIntoViewIfNeeded();
        await click(bag.getByRole("button", { name: "關閉背包" }));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await click(page.getByRole("button", { name: /收合菜單，放大街景/ }));
      await click(bagToggle); await bag.getByLabel("顯示成就徽章").scrollIntoViewIfNeeded();
      await click(bag.getByRole("button", { name: "關閉背包" }));
    }
    assert.deepEqual(errors, []);
    console.log("✓ 背包獨立文字入口、任務互斥、窄螢幕／橫向／放大街景捲動與關閉");
    await context.close();
  }
} finally { await browser.close(); }
