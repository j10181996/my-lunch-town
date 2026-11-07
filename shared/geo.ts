import type { GeoPoint } from "./contracts";

const EARTH_RADIUS_M = 6_371_000;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "INVALID_INPUT" as const });
}

/** 純函式；驗證並四捨五入到小數 6 位（約 0.1 公尺）。錯誤帶 INVALID_INPUT，由 API 邊界轉成 err.invalid。 */
export function validateGeoPoint(input: unknown, field = "位置"): GeoPoint {
  if (!input || typeof input !== "object") return invalid(`${field}格式錯誤`);
  const { lat, lng } = input as GeoPoint;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return invalid(`${field}須為緯度 -90 至 90、經度 -180 至 180`);
  }
  return { lat: round6(lat), lng: round6(lng) };
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * 解析貼上的座標：「24.1477, 120.6736」、全形逗號或空白分隔，
 * 以及 Google 地圖網址中的「@緯度,經度」或「q=緯度,經度」。無法解析回 null。
 */
export function parseGeoText(text: string): GeoPoint | null {
  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`@${num},${num}`),
    new RegExp(String.raw`[?&](?:q|query|ll)=${num},${num}`),
    new RegExp(String.raw`^\s*${num}\s*[,，\s]\s*${num}\s*$`),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    try {
      return validateGeoPoint({ lat: Number(m[1]), lng: Number(m[2]) });
    } catch {
      return null;
    }
  }
  return null;
}

/** 兩點的球面直線距離（haversine），四捨五入至 0.1 公里；不是道路距離。 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(meters / 100) / 10;
}

export function formatGeo(p: GeoPoint): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

export function mapsUrl(p: GeoPoint): string {
  return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
}
