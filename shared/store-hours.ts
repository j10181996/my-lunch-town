import type { StoreHours } from "./contracts";
const MINUTE = 60_000, DAY = 1440, WEEK = DAY * 7;
const clock = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const validTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function validateStoreHours(input: unknown): StoreHours | null {
  if (input === null) return null;
  const h = input as StoreHours | undefined;
  if (!h || !Array.isArray(h.weekly) || h.weekly.length !== 7 || !(h.cutoff === null || validTime(h.cutoff))) {
    throw new Error("請提供七天營業時段及有效的接單截止時間");
  }
  const ranges: Array<[number, number]> = [];
  const weekly = h.weekly.map((slots, day) => {
    if (!Array.isArray(slots) || slots.length > 3) throw new Error("每天最多三個營業時段");
    return slots.map((slot) => {
      if (!slot || !validTime(slot.open) || !validTime(slot.close) || slot.open === slot.close) throw new Error("營業時間須為 HH:mm，開始與結束不可相同");
      const start = day * DAY + clock(slot.open);
      const end = day * DAY + clock(slot.close) + (slot.close < slot.open ? DAY : 0);
      ranges.push([start, end]);
      return { open: slot.open, close: slot.close };
    });
  });
  for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
    for (const shift of [-WEEK, 0, WEEK]) if (ranges[i][0] < ranges[j][1] + shift && ranges[i][1] > ranges[j][0] + shift) throw new Error("營業時段不可重疊（包含跨日）");
  }
  return { weekly, cutoff: h.cutoff };
}

/** Taiwan is UTC+8. Use UTC getters on a shifted instant, independent of host timezone. */
export function storeOpening(hours: StoreHours | null, now = Date.now()): { open: boolean; deadline: number | null } {
  if (!hours) return { open: true, deadline: null };
  const taiwan = new Date(now + 8 * 60 * MINUTE);
  const today = taiwan.getUTCDay();
  const minute = taiwan.getUTCHours() * 60 + taiwan.getUTCMinutes();
  const midnight = now - minute * MINUTE - taiwan.getUTCSeconds() * 1000 - taiwan.getUTCMilliseconds();
  for (const offset of [0, -1]) {
    const day = (today + offset + 7) % 7;
    for (const slot of hours.weekly[day]) {
      const start = midnight + (offset * DAY + clock(slot.open)) * MINUTE;
      const overnight = slot.close < slot.open;
      const end = midnight + (offset * DAY + clock(slot.close) + (overnight ? DAY : 0)) * MINUTE;
      if (now >= start && now < end) {
        const cutoff = hours.cutoff === null ? null : clock(hours.cutoff);
        const deadline = cutoff === null ? null : midnight + (offset * DAY + cutoff + (overnight && cutoff < clock(slot.open) ? DAY : 0)) * MINUTE;
        return { open: true, deadline };
      }
    }
  }
  return { open: false, deadline: null };
}
