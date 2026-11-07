import { describe, expect, it } from "vitest";
import { ownerCall } from "../../web/game/owner-calls";

const NOW = Date.UTC(2026, 10, 9, 4, 0);
const MIN = 60_000;

describe("團主喊話", () => {
  it("截止前 5 分鐘內提醒一次，截止時間改了再提醒", () => {
    const at = NOW + 4.2 * MIN;
    expect(ownerCall({ status: "open", deadlineAt: at }, true, null, NOW))
      .toEqual({ text: "再 5 分鐘收單，還沒點的快喔！", reminded: at });
    expect(ownerCall({ status: "open", deadlineAt: at }, true, at, NOW)).toBeNull();
    expect(ownerCall({ status: "open", deadlineAt: at + 0.5 * MIN }, true, at, NOW)?.reminded).toBe(at + 0.5 * MIN);
  });

  it("還早、沒設截止或已過截止都不提醒", () => {
    expect(ownerCall({ status: "open", deadlineAt: NOW + 6 * MIN }, true, null, NOW)).toBeNull();
    expect(ownerCall({ status: "open", deadlineAt: null }, true, null, NOW)).toBeNull();
    expect(ownerCall({ status: "open" }, true, null, NOW)).toBeNull();
    expect(ownerCall({ status: "open", deadlineAt: NOW - 1 }, true, null, NOW)).toBeNull();
  });

  it("只在看到收單那一刻喊收單，打開已收單的團不喊", () => {
    expect(ownerCall({ status: "closed" }, true, null, NOW)?.text).toBe("收單囉！謝謝大家～");
    expect(ownerCall({ status: "closed" }, false, null, NOW)).toBeNull();
  });
});
