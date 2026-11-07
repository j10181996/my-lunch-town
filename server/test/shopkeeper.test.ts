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

  it("店家快不接單時店主優先提醒，且不輪替", () => {
    expect(lines({ deadlineAt: NOON + 4.5 * 60000 }, 3)).toEqual(Array(3).fill("本店再 5 分鐘就不接單囉！"));
    expect(lines({ deadlineAt: NOON + 30 * 60000 }, 1)).toEqual(["歡迎光臨！午餐時間到～"]);
    expect(lines({ deadlineAt: NOON - 60000 }, 1)).toEqual(["歡迎光臨！午餐時間到～"]);
  });

  it("團收單後店主不喊收單，也不再叫人去點餐", () => {
    const said = lines({ roomClosed: true, deadlineAt: NOON + 60000 }, 4);
    expect(said[0]).toBe("歡迎光臨！午餐時間到～");
    expect(said.join()).not.toMatch(/收單|不接單|按 Enter/);
  });

  it("散步模式邀請開團，不提收單與點餐", () => {
    const said = lines({ solo: true, roomClosed: true, deadlineAt: NOON + 60000, ordered: [{ name: "雞腿便當", quantity: 1 }] }, 4);
    expect(said).toContain("喜歡的話，揪大家來開團吧！");
    expect(said.join()).not.toMatch(/收單|馬上準備|按 Enter/);
  });

  it("不在本團的店：推薦但不叫人點餐，也不提接單截止", () => {
    const said = lines({ notInRoom: true, deadlineAt: NOON + 60000 }, 4);
    expect(said).toContain("這次沒揪到我們家，下次見！");
    expect(said).toContain("推薦「雞腿便當」，NT$120！");
    expect(said.join()).not.toMatch(/不接單|按 Enter/);
  });

  it("沒有供應的餐點時不推薦", () => {
    expect(lines({ meals: [] }, 3)).toContain("今天的菜還在準備中喔。");
  });
});
