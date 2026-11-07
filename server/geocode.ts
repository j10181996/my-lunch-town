import type { GeocodeResult } from "../shared/contracts";
import { validateGeoPoint } from "../shared/geo";
import { geocodeQueries, parseTwAddress, pickPlace, type NominatimPlace } from "../shared/tw-address";
import { AppError, err } from "./db-shared";

/**
 * 地址轉座標：伺服器轉送 OpenStreetMap Nominatim。
 * 遵守使用規範：識別用 User-Agent、全域每秒最多 1 次、結果快取、不做邊打字邊查。
 * 只送出地址文字，不附任何使用者資料。Node 與 Worker 共用（Worker 每個 isolate 各自計數與快取）。
 */
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "my-lunch-town/1.0 (internal lunch ordering)";

type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GeocoderOptions {
  fetcher?: Fetcher;
  minIntervalMs?: number;
  /** 同時排隊的查詢上限（每筆地址最多 4 次請求）；超過回 RETRY_LATER。 */
  maxPending?: number;
  cacheSize?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createGeocoder(options: GeocoderOptions = {}) {
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const minInterval = options.minIntervalMs ?? 1100;
  const maxPending = options.maxPending ?? 5;
  const cacheSize = options.cacheSize ?? 200;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const cache = new Map<string, GeocodeResult | null>();
  let chain: Promise<unknown> = Promise.resolve();
  let lastCall = -Infinity;
  let pending = 0;

  async function request(params: Record<string, string>): Promise<NominatimPlace[]> {
    const wait = lastCall + minInterval - now();
    if (wait > 0) await sleep(wait);
    lastCall = now();
    const url = new URL(ENDPOINT);
    for (const [k, v] of Object.entries({ ...params, format: "jsonv2", addressdetails: "1", limit: "5", "accept-language": "zh-TW" })) {
      url.searchParams.set(k, v);
    }
    let res;
    try {
      res = await fetcher(url.toString(), { headers: { "User-Agent": USER_AGENT } });
    } catch {
      throw unavailable();
    }
    if (!res.ok) throw unavailable();
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? body as NominatimPlace[] : [];
  }

  async function lookup(address: string): Promise<GeocodeResult | null> {
    const parsed = parseTwAddress(address);
    for (const query of geocodeQueries(parsed)) {
      const place = pickPlace(await request(query.params), query, parsed);
      if (!place) continue;
      return {
        location: validateGeoPoint({ lat: Number(place.lat), lng: Number(place.lon) }),
        precision: query.precision,
        label: place.display_name,
      };
    }
    return null;
  }

  return async function geocode(raw: unknown): Promise<GeocodeResult> {
    if (typeof raw !== "string") throw err.invalid("請輸入地址");
    const address = raw.trim();
    if ([...address].length < 4 || [...address].length > 100) throw err.invalid("地址需為 4 至 100 個字");
    const key = parseTwAddress(address).normalized;
    if (cache.has(key)) return found(cache.get(key)!);
    if (pending >= maxPending) throw new AppError("RETRY_LATER", 503, "查詢地址的人太多，請稍後再試");
    pending++;
    const run = chain.then(() => lookup(address));
    chain = run.catch(() => undefined); // 一筆失敗不影響後面排隊的查詢
    try {
      const result = await run;
      cache.set(key, result);
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
      return found(result);
    } finally {
      pending--;
    }
  };
}

function found(result: GeocodeResult | null): GeocodeResult {
  if (!result) throw err.invalid("查不到這個地址的位置，請確認地址，或改用手動設定位置");
  return result;
}

function unavailable() {
  return new AppError("RETRY_LATER", 503, "地址查詢服務暫時無法使用，請稍後再試，或改用手動設定位置");
}

/** 路由用的共用實例。 */
export const geocodeAddress = createGeocoder();
