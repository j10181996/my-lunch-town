import { describe, expect, it } from "vitest";
import { ACTIVE_WINDOW_MS, POLL_MS, pollDelay } from "../../web/adapters/poll-policy";

describe("Sites 同步輪詢間隔", () => {
  const now = 100_000;

  it("斷線時固定重試，不受分頁與活動影響", () => {
    expect(pollDelay({ online: false, hidden: true, now, lastActivity: now })).toBe(POLL_MS.offline);
  });

  it("背景分頁降頻，但仍在 presence TTL（10 秒）內續命", () => {
    expect(pollDelay({ online: true, hidden: true, now, lastActivity: now })).toBe(POLL_MS.hidden);
    expect(POLL_MS.hidden).toBeLessThan(10_000);
  });

  it("剛有人移動或訂單變動時快速輪詢", () => {
    expect(pollDelay({ online: true, hidden: false, now, lastActivity: now - ACTIVE_WINDOW_MS + 1 })).toBe(POLL_MS.active);
  });

  it("閒置超過活動視窗後降為每秒一次", () => {
    expect(pollDelay({ online: true, hidden: false, now, lastActivity: now - ACTIVE_WINDOW_MS })).toBe(POLL_MS.idle);
    expect(pollDelay({ online: true, hidden: false, now, lastActivity: 0 })).toBe(POLL_MS.idle);
  });
});
