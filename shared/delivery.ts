import type { DeliveryRules, Point, Room, RoomStoreOrder, Store } from "./contracts";
import { haversineKm } from "./geo";
import { STREET_H, STREET_W } from "./town";

/** 舊團（遊戲街區座標）用：依地段經度跨距換算的近似值，非道路距離。 */
export const METERS_PER_PX = 4;

export function distanceKm(point: Point, door: Point): number {
  const meters = Math.hypot((point.x - door.x) * STREET_W, (point.y - door.y) * STREET_H) * METERS_PER_PX;
  return Math.round(meters / 100) / 10;
}

/** 純函式；伺服器將帶 INVALID_INPUT 的驗證錯誤轉為 err.invalid。 */
export function validateDeliveryRules(input: unknown): DeliveryRules {
  const invalid = (message: string): never => {
    throw Object.assign(new Error(message), { code: "INVALID_INPUT" as const });
  };
  if (!input || typeof input !== "object") return invalid("請提供外送設定");
  const r = input as DeliveryRules;
  if (typeof r.enabled !== "boolean" || !Array.isArray(r.tiers)) return invalid("外送設定格式錯誤");
  if (r.tiers.length > 5 || (r.enabled && r.tiers.length === 0)) return invalid("外送距離需設定 1 至 5 段");
  let previous = 0;
  const tiers = r.tiers.map((tier) => {
    if (!tier || typeof tier !== "object") return invalid("外送分段格式錯誤");
    const { maxKm, minTwd } = tier;
    if (typeof maxKm !== "number" || !Number.isFinite(maxKm) || maxKm < 0.1 || maxKm > 20
      || Math.round(maxKm * 10) / 10 !== maxKm || maxKm <= previous) {
      return invalid("公里數須為 0.1 至 20、最多一位小數，並嚴格遞增");
    }
    if (typeof minTwd !== "number" || !Number.isInteger(minTwd) || minTwd < 0 || minTwd > 99999) {
      return invalid("最低金額須為 0 至 99999 的整數");
    }
    previous = maxKm;
    return { maxKm, minTwd };
  });
  return { enabled: r.enabled, tiers };
}

export type DeliveryResult =
  | { kind: "no-point" }
  | { kind: "not-set" }
  | { kind: "pickup-only" }
  | { kind: "no-store-location" }
  | { kind: "out-of-range"; distanceKm: number; maxKm: number }
  | { kind: "below-min"; distanceKm: number; minTwd: number; shortTwd: number }
  | { kind: "ok"; distanceKm: number; minTwd: number };

export function evaluateDelivery(
  rules: DeliveryRules | null | undefined,
  km: number | null,
  subtotalTwd: number,
): DeliveryResult {
  if (km === null) return { kind: "no-point" };
  if (!rules) return { kind: "not-set" };
  if (!rules.enabled) return { kind: "pickup-only" };
  const tier = rules.tiers.find((t) => km <= t.maxKm);
  if (!tier) return { kind: "out-of-range", distanceKm: km, maxKm: rules.tiers.at(-1)!.maxKm };
  if (subtotalTwd < tier.minTwd) {
    return { kind: "below-min", distanceKm: km, minTwd: tier.minTwd, shortTwd: tier.minTwd - subtotalTwd };
  }
  return { kind: "ok", distanceKm: km, minTwd: tier.minTwd };
}

type RoomPlace = Pick<Room, "deliveryPoint" | "deliveryLocation">;
type StorePlace = Pick<Store, "door" | "delivery" | "location">;

/**
 * 送餐位置到店家的距離。新團用真實經緯度；舊團只有街區座標時沿用像素換算。
 * 店家沒設位置或團沒選位置時回 null。
 */
export function storeDistanceKm(room: RoomPlace, store: StorePlace): number | null {
  if (room.deliveryLocation) return store.location ? haversineKm(room.deliveryLocation, store.location) : null;
  return room.deliveryPoint ? distanceKm(room.deliveryPoint, store.door) : null;
}

/** 收單與畫面共用：依團的送餐位置、店家凍結的規則與位置、該店小計判斷外送或自取。 */
export function evaluateStoreDelivery(room: RoomPlace, store: StorePlace, subtotalTwd: number): DeliveryResult {
  if (!room.deliveryLocation && !room.deliveryPoint) return { kind: "no-point" };
  if (!store.delivery) return { kind: "not-set" };
  if (!store.delivery.enabled) return { kind: "pickup-only" };
  const km = storeDistanceKm(room, store);
  if (km === null) return { kind: "no-store-location" };
  return evaluateDelivery(store.delivery, km, subtotalTwd);
}

export function fulfillmentOf(result: DeliveryResult): "delivery" | "pickup" {
  return result.kind === "ok" ? "delivery" : "pickup";
}

export function describeDelivery(result: DeliveryResult): string {
  switch (result.kind) {
    case "no-point": return "未選送餐地點，全部自取";
    case "not-set": return "店家未設定外送，預設自取";
    case "pickup-only": return "店家只提供自取";
    case "no-store-location": return "店家未設定位置，無法計算距離，需自取";
    case "out-of-range":
      return `超出外送範圍（${result.distanceKm} 公里，最遠 ${result.maxKm} 公里），需自取`;
    case "below-min":
      return `外送門檻 $${result.minTwd}（${result.distanceKm} 公里），還差 $${result.shortTwd}`;
    case "ok": return `✓ 已達外送門檻（${result.distanceKm} 公里，門檻 $${result.minTwd}）`;
  }
}

export function describeFulfillment(order: Pick<RoomStoreOrder, "fulfillment" | "distanceKm" | "deliveryMinTwd">) {
  return order.fulfillment === "delivery"
    ? `外送・${order.distanceKm} 公里（門檻 $${order.deliveryMinTwd}）`
    : "自取";
}
