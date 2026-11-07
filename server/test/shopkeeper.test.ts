import { describe, expect, it } from "vitest";
import { shopkeeperLine, type ShopkeeperContext } from "../../web/game/shopkeeper";

// 2026-11-09 12:00（台北）＝ 04:00 UTC
const NOON = Date.UTC(2026, 10, 9, 4, 0);
const base: ShopkeeperContext = {
  meals: [{ name: "雞腿便當", priceTwd: 120 }, { name: "排骨便當", priceTwd: 110 }],
  ordered: [], roomClosed: false, deadlineAt: null, solo: false, talk: 0, now: NOON,
};
const lines = (ctx: Partial<ShopkeeperContext>, count: number) =>
  Array.from({ length: count }, (_, talk) => shopkeeperLine({ ...base, ...ctx, talk }));

describe("店主台詞", () => {
  it("第一句依台北時段打招呼", () => {
    expect(shopkeeperLine(base)).toBe("歡迎光臨！午餐時間到～");
    expect(shopkeeperLine({ ...base, now: Date.UTC(2026, 10, 9, 0, 30) })).toBe("早安！今天也準備好了。");
    expect(shopkeeperLine({ ...base, now: Date.UTC(2026, 10, 9, 11, 0) })).toBe("辛苦了，晚餐也交給我吧！");
  });

  it("連續說話會輪替台詞，推薦也會換一道", () => {
    const said = lines({}, 6);
    expect(said.slice(0, 3)).toEqual(["歡迎光臨！午餐時間到～", "推薦「雞腿便當」，NT$120！", "站到陳列台前按 Enter 點餐喔。"]);
    expect(said[4]).toBe("推薦「排骨便當」，NT$110！");
  });

  it("已點餐時複誦點了什麼", () => {
    expect(lines({ ordered: [{ name: "雞腿便當", quantity: 2 }] }, 4)).toContain("雞腿便當×2，馬上準備！");
    expect(lines({ ordered: [{ name: "雞腿便當", quantity: 1 }, { name: "排骨便當", quantity: 1 }] }, 4))
      .toContain("2 樣餐點都記下了，馬上準備！");
  });

  it("收單與截止前提醒優先，且不輪替", () => {
    expect(new Set(lines({ roomClosed: true }, 4))).toEqual(new Set(["這團已收單，下次再來喔！"]));
    expect(lines({ deadlineAt: NOON + 4.5 * 60000 }, 3)).toEqual(Array(3).fill("再 5 分鐘截止收單，要快喔！"));
    expect(lines({ deadlineAt: NOON + 30 * 60000 }, 1)).toEqual(["歡迎光臨！午餐時間到～"]);
    expect(lines({ deadlineAt: NOON - 60000 }, 1)).toEqual(["歡迎光臨！午餐時間到～"]);
  });

  it("散步模式邀請開團，不提收單與點餐", () => {
    const said = lines({ solo: true, roomClosed: true, deadlineAt: NOON + 60000, ordered: [{ name: "雞腿便當", quantity: 1 }] }, 4);
    expect(said).toContain("喜歡的話，揪大家來開團吧！");
    expect(said.join()).not.toMatch(/收單|馬上準備|按 Enter/);
  });

  it("沒有供應的餐點時不推薦", () => {
    expect(lines({ meals: [] }, 3)).toContain("今天的菜還在準備中喔。");
  });
});
