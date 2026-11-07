import { describe, expect, it } from "vitest";
import { emptyRegulars, favoriteMeal, recordMeals, recordVisit, regularGreeting, REGULAR_VISITS, SNACKS, taipeiDay, tryTasting } from "../../web/game/regulars";
import { shopkeeperLine } from "../../web/game/shopkeeper";
import { ACHIEVEMENTS } from "../../web/game/collection";
import { BADGE_IDS, isBadgeId } from "../../shared/social";

describe("店主認得常客", () => {
  it("同一家店同一天只算一次造訪", () => {
    let data = recordVisit(emptyRegulars(), "store-af", "2026-11-09");
    data = recordVisit(data, "store-af", "2026-11-09");
    expect(data.stores["store-af"].visits).toBe(1);
    data = recordVisit(data, "store-af", "2026-11-10");
    expect(data.stores["store-af"].visits).toBe(2);
  });

  it("依造訪天數換招呼，常客會被問是不是老樣子", () => {
    expect(regularGreeting(undefined)).toBeNull();
    let data = emptyRegulars();
    for (let day = 1; day <= REGULAR_VISITS; day++) {
      data = recordVisit(data, "store-af", `2026-11-0${day}`);
      if (day === 1) expect(regularGreeting(data.stores["store-af"])).toBe("第一次來嗎？歡迎光臨！");
      if (day === 2) expect(regularGreeting(data.stores["store-af"])).toBe("又見面了！歡迎回來～");
    }
    expect(regularGreeting(data.stores["store-af"])).toBe("老朋友來啦！老位子留給你～");
    data = recordMeals(data, "room-1", [{ storeId: "store-af", name: "招牌雞腿飯", quantity: 2 }, { storeId: "store-af", name: "滷排骨飯", quantity: 1 }]);
    expect(regularGreeting(data.stores["store-af"])).toBe("又來啦！今天也是招牌雞腿飯？");
  });

  it("同一團的點餐只記一次", () => {
    let data = recordMeals(emptyRegulars(), "room-1", [{ storeId: "store-af", name: "滷排骨飯", quantity: 1 }]);
    data = recordMeals(data, "room-1", [{ storeId: "store-af", name: "滷排骨飯", quantity: 1 }]);
    expect(data.stores["store-af"].meals).toEqual({ 滷排骨飯: 1 });
    expect(favoriteMeal(data.stores["store-af"])).toBe("滷排骨飯");
    expect(recordMeals(data, "room-2", [])).toBe(data);
  });

  it("常客招呼取代時段招呼，其他台詞照常輪替", () => {
    const base = { meals: [], ordered: [], roomClosed: false, deadlineAt: null, solo: false, now: Date.UTC(2026, 10, 9, 4, 0) };
    expect(shopkeeperLine({ ...base, talk: 0, regularGreeting: "又見面了！歡迎回來～" })).toBe("又見面了！歡迎回來～");
    expect(shopkeeperLine({ ...base, talk: 0 })).toBe("歡迎光臨！午餐時間到～");
  });
});

describe("每日試吃", () => {
  it("每家店每天一次，隔天可再試吃", () => {
    const first = tryTasting(emptyRegulars(), "store-af", "阿福便當", "2026-11-09");
    expect(first).not.toBeNull();
    expect(SNACKS.map((s) => s.name)).toContain(first!.snack.name);
    expect(first!.data.snacks).toHaveLength(1);
    expect(tryTasting(first!.data, "store-af", "阿福便當", "2026-11-09")).toBeNull();
    expect(tryTasting(first!.data, "store-tree", "大樹麵店", "2026-11-09")).not.toBeNull();
    expect(tryTasting(first!.data, "store-af", "阿福便當", "2026-11-10")).not.toBeNull();
  });

  it("日期以台北時間計算", () => {
    expect(taipeiDay(Date.UTC(2026, 10, 9, 16, 30))).toBe("2026-11-10");
  });
});

describe("成就徽章", () => {
  it("可廣播的徽章與前端成就清單一致", () => {
    expect([...BADGE_IDS].sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
    expect(isBadgeId("regular")).toBe(true);
    expect(isBadgeId("hacker")).toBe(false);
  });
});
