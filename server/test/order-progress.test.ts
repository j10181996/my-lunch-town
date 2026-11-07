import { describe, expect, it } from "vitest";
import { doorEffects, ownerOrderCall, shopkeeperProgressLine } from "../../web/game/order-progress";
import { shopkeeperLine, type ShopkeeperContext } from "../../web/game/shopkeeper";
import type { StoreOrderStatus } from "../../shared/contracts";

const order = (storeId: string, storeName: string, status: StoreOrderStatus, fulfillment: "delivery" | "pickup" = "pickup") =>
  ({ storeId, storeName, status, fulfillment });

describe("出餐進度演出", () => {
  it("店門口：製作中冒煙、完成放便當袋，其他狀態沒有演出", () => {
    const effects = doorEffects([order("a", "阿福", "preparing"), order("b", "大樹", "ready"), order("c", "綠芽", "accepted"), order("d", "小吃", "rejected")]);
    expect(Object.fromEntries(effects)).toEqual({ a: "smoke", b: "bag" });
    expect(doorEffects(undefined).size).toBe(0);
  });

  it("團主只在親眼看到狀態變化時喊話", () => {
    expect(ownerOrderCall(undefined, [order("a", "阿福便當", "ready")])).toBeNull();
    expect(ownerOrderCall([order("a", "阿福便當", "ready")], [order("a", "阿福便當", "ready")])).toBeNull();
    expect(ownerOrderCall([order("a", "阿福便當", "accepted")], [order("a", "阿福便當", "preparing")])).toBeNull();
  });

  it("完成時依自取或外送喊不同的話，多家同時完成合成一句", () => {
    expect(ownerOrderCall([order("a", "阿福便當", "preparing")], [order("a", "阿福便當", "ready")])).toBe("阿福便當好了，誰去拿一下！");
    expect(ownerOrderCall([order("a", "阿福便當", "preparing", "delivery")], [order("a", "阿福便當", "ready", "delivery")]))
      .toBe("阿福便當做好了，等外送喔！");
    expect(ownerOrderCall([order("a", "阿福", "preparing"), order("b", "大樹", "accepted")], [order("a", "阿福", "ready"), order("b", "大樹", "ready")]))
      .toBe("2 家都好了，大家來拿！");
  });

  it("拒單優先喊", () => {
    expect(ownerOrderCall([order("a", "阿福", "preparing"), order("b", "大樹麵店", "sent")], [order("a", "阿福", "ready"), order("b", "大樹麵店", "rejected")]))
      .toBe("大樹麵店今天不能做，要換一家了");
  });

  it("店主依進度說話，進度取代「馬上準備」", () => {
    expect(shopkeeperProgressLine(undefined)).toBeNull();
    const base: ShopkeeperContext = { meals: [{ name: "雞腿便當", priceTwd: 120 }], ordered: [{ name: "雞腿便當", quantity: 1 }],
      roomClosed: true, deadlineAt: null, solo: false, talk: 0, now: Date.UTC(2026, 10, 9, 4, 0) };
    const said = (orderStatus: StoreOrderStatus) => [0, 1, 2, 3].map((talk) => shopkeeperLine({ ...base, orderStatus, talk }));
    expect(said("preparing")[0]).toBe("便當在做囉～");
    expect(said("ready")[0]).toBe("做好囉，可以來拿了！");
    expect(said("ready").join()).not.toMatch(/馬上準備/);
    expect(shopkeeperLine({ ...base, orderStatus: "ready", notInRoom: true })).not.toBe("做好囉，可以來拿了！");
  });
});
