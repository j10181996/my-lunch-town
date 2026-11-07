import { describe, expect, it } from "vitest";
import { budgetStatus, dietTagsOf, matchesDietFilters } from "../../shared/diet";

describe("飲食標籤", () => {
  it("標準標籤與常見舊寫法都能辨識，全素一定是素食，自訂標籤忽略", () => {
    expect([...dietTagsOf(["素", "招牌", "麻辣"])].sort()).toEqual(["素食", "辣"].sort());
    expect([...dietTagsOf(["全素"])].sort()).toEqual(["全素", "素食"].sort());
    expect([...dietTagsOf(["粥麵擇一", "飲料"])]).toEqual([]);
    expect([...dietTagsOf([" 含蛋 ", "花生"])].sort()).toEqual(["含堅果", "含蛋"].sort());
  });
  it("「只看」要求有標籤、「不要」要求沒有標籤，多個條件同時成立", () => {
    expect(matchesDietFilters(["素"], ["veg"])).toBe(true);
    expect(matchesDietFilters(["全素"], ["veg"])).toBe(true);
    expect(matchesDietFilters(["素食"], ["vegan"])).toBe(false);
    expect(matchesDietFilters([], ["veg"])).toBe(false);
    expect(matchesDietFilters(["素", "辣"], ["veg", "no-spicy"])).toBe(false);
    expect(matchesDietFilters(["素", "含蛋"], ["veg", "no-spicy"])).toBe(true);
    expect(matchesDietFilters(["含蛋"], ["no-egg"])).toBe(false);
    expect(matchesDietFilters(["蝦"], ["no-seafood"])).toBe(false);
    expect(matchesDietFilters(["招牌"], [])).toBe(true);
  });
});

describe("預算", () => {
  it("未設定時沒有狀態；剛好等於預算不算超出，超過一元就提醒", () => {
    expect(budgetStatus(200, null)).toBeNull();
    expect(budgetStatus(200, 0)).toBeNull();
    expect(budgetStatus(150, 150)).toEqual({ budgetTwd: 150, remainingTwd: 0, over: false });
    expect(budgetStatus(151, 150)).toEqual({ budgetTwd: 150, remainingTwd: -1, over: true });
    expect(budgetStatus(90, 150)).toEqual({ budgetTwd: 150, remainingTwd: 60, over: false });
  });
});
