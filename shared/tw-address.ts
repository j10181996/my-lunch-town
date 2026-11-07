/**
 * 台灣地址解析與 Nominatim 查詢策略（純函式，Node、Worker、前端共用）。
 * 只做查座標需要的正規化：不驗證地址是否存在。
 */

export interface TwAddress {
  /** 縣市，如「臺中市」 */
  city?: string;
  /** 區鄉鎮市，如「西區」 */
  district?: string;
  /** 路街含段，如「南屯路二段」 */
  road?: string;
  /** 巷弄，如「146巷」「3弄」 */
  lane?: string;
  /** 門牌，「-」已轉「之」，如「130之1號」 */
  house?: string;
  /** 正規化後的整段地址（去掉郵遞區號、樓層與之後的說明） */
  normalized: string;
}

export type GeocodePrecision = "house" | "street" | "area";

export interface GeocodeQuery {
  params: Record<string, string>;
  precision: GeocodePrecision;
  /** 門牌層級必須完全吻合的門牌號 */
  house?: string;
}

const CITY_FIX: Array<[RegExp, string]> = [[/台(北|中|南|東)/g, "臺$1"]];

export function normalizeTwAddress(input: string): string {
  let s = input.normalize("NFKC") // 全形數字、符號轉半形
    .replace(/\s+/g, "")
    .replace(/[‐‑‒–—―ー]/g, "-");
  for (const [re, to] of CITY_FIX) s = s.replace(re, to);
  s = s.replace(/^\d{3,6}/, ""); // 郵遞區號
  s = s.replace(/^(臺灣|台灣)省?(?=[^\d]{1,3}[市縣])/, ""); // 不動「臺灣大道」
  // 門牌之後的樓層、室、說明都不需要
  const house = /\d+(?:[-之]\d+)?號/.exec(s);
  if (house) s = s.slice(0, house.index + house[0].length);
  return s.replace(/(\d+)-(\d+)號$/, "$1之$2號");
}

export function parseTwAddress(input: string): TwAddress {
  const normalized = normalizeTwAddress(input);
  const m = /^(?<city>[^\d市縣區鄉鎮路街]{1,3}[市縣])?(?<district>[^\d區鄉鎮市路街]{1,3}[區鄉鎮市])?(?:[^\d里村]{1,3}[里村])?(?:\d+鄰)?(?<road>[^\d]+?(?:路|街|大道)(?:[一二三四五六七八九十]+段)?)(?<lane>\d+巷)?(?<alley>\d+弄)?(?<house>\d+(?:之\d+)?號)?$/
    .exec(normalized);
  if (!m?.groups) return { normalized };
  const g = m.groups;
  return {
    normalized,
    city: g.city,
    district: g.district,
    road: g.road,
    lane: g.lane || g.alley ? `${g.lane ?? ""}${g.alley ?? ""}` : undefined,
    house: g.house,
  };
}

/** 依序嘗試：門牌 → 巷弄 → 路段 → 整段文字。 */
export function geocodeQueries(address: TwAddress): GeocodeQuery[] {
  const area = { ...(address.city ? { city: address.city } : {}), country: "Taiwan" };
  const queries: GeocodeQuery[] = [];
  if (address.road) {
    const street = `${address.road}${address.lane ?? ""}`;
    if (address.house) queries.push({ params: { ...area, street: `${address.house} ${street}` }, precision: "house", house: address.house });
    if (address.lane) queries.push({ params: { ...area, street }, precision: "street" });
    queries.push({ params: { ...area, street: address.road }, precision: "street" });
  }
  queries.push({ params: { q: address.normalized, countrycodes: "tw" }, precision: "area" });
  return queries;
}

export interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  address?: { house_number?: string; city?: string; suburb?: string; town?: string; county?: string };
}

/** 從候選中挑結果：門牌須完全吻合；有寫區或縣市時須在同一區、同一縣市。 */
export function pickPlace(places: NominatimPlace[], query: GeocodeQuery, address: TwAddress): NominatimPlace | null {
  return places.find((p) => {
    if (address.city && !p.display_name.includes(address.city)) return false;
    if (address.district && !p.display_name.includes(address.district)) return false;
    if (query.house && p.address?.house_number !== query.house) return false;
    return Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon));
  }) ?? null;
}
