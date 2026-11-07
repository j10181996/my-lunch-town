import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeQueries, parseTwAddress } from "../../shared/tw-address";
import { createGeocoder } from "../geocode";

describe("台灣地址解析", () => {
  it.each([
    ["臺中市西區昇平街132號", { city: "臺中市", district: "西區", road: "昇平街", house: "132號" }],
    ["台中市西屯區市政北二路１００號８樓之3", { city: "臺中市", district: "西屯區", road: "市政北二路", house: "100號", normalized: "臺中市西屯區市政北二路100號" }],
    ["西屯區市政北二路100號", { city: undefined, district: "西屯區", road: "市政北二路", house: "100號" }],
    ["臺中市西區公正路130-1號", { road: "公正路", house: "130之1號" }],
    ["臺中市南區學府路146巷142號", { road: "學府路", lane: "146巷", house: "142號" }],
    ["40756臺灣臺中市西屯區臺灣大道三段99號", { city: "臺中市", district: "西屯區", road: "臺灣大道三段", house: "99號" }],
    ["彰化縣員林市中山路一段1號", { city: "彰化縣", district: "員林市", road: "中山路一段", house: "1號" }],
    ["臺中市北屯區文心路四段3弄5號2樓", { road: "文心路四段", lane: "3弄", house: "5號" }],
  ])("%s", (input, expected) => {
    expect(parseTwAddress(input)).toMatchObject(expected);
  });

  it("看不懂的地址只保留正規化文字，仍可用整段文字查詢", () => {
    const parsed = parseTwAddress("公司樓下");
    expect(parsed).toEqual({ normalized: "公司樓下" });
    expect(geocodeQueries(parsed)).toEqual([{ params: { q: "公司樓下", countrycodes: "tw" }, precision: "area" }]);
  });

  it("查詢順序：門牌 → 巷弄 → 路段 → 整段文字", () => {
    expect(geocodeQueries(parseTwAddress("臺中市南區學府路146巷142號")).map((q) => [q.precision, q.params.street ?? q.params.q])).toEqual([
      ["house", "142號 學府路146巷"],
      ["street", "學府路146巷"],
      ["street", "學府路"],
      ["area", "臺中市南區學府路146巷142號"],
    ]);
  });
});

const place = (lat: number, lng: number, display: string, house?: string) =>
  ({ lat: String(lat), lon: String(lng), display_name: display, address: house ? { house_number: house } : {} });

function fakeNominatim(respond: (params: URLSearchParams) => unknown[] | "fail" | "throw") {
  const calls: Array<{ params: URLSearchParams; headers: Record<string, string> }> = [];
  const fetcher = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    const params = new URL(url).searchParams;
    calls.push({ params, headers: init.headers });
    const r = respond(params);
    if (r === "throw") throw new Error("network");
    if (r === "fail") return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  });
  return { fetcher, calls };
}

describe("地址推算座標", () => {
  const sleep = vi.fn(async () => {});
  afterEach(() => sleep.mockClear());

  it("門牌吻合即回傳，並帶識別用 User-Agent、限定台灣與繁中", async () => {
    const { fetcher, calls } = fakeNominatim(() => [place(24.1456369, 120.6600005, "132號, 昇平街, 西區, 臺中市, 臺灣", "132號")]);
    const geocode = createGeocoder({ fetcher, sleep });
    expect(await geocode(" 臺中市西區昇平街132號 ")).toEqual({
      location: { lat: 24.145637, lng: 120.660001 }, precision: "house", label: "132號, 昇平街, 西區, 臺中市, 臺灣",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["User-Agent"]).toMatch(/^my-lunch-town\//);
    expect(Object.fromEntries(calls[0].params)).toMatchObject({ street: "132號 昇平街", city: "臺中市", country: "Taiwan", format: "jsonv2" });
  });

  it("門牌不吻合或不同區時往下一層找，標示為路段", async () => {
    const { fetcher, calls } = fakeNominatim((p) => p.get("street") === "學府路146巷"
      ? [place(24.13, 120.67, "學府路146巷, 北區, 臺中市"), place(24.1288874, 120.6744471, "學府路146巷, 南區, 臺中市")]
      : [place(1, 1, "142號, 學府路146巷, 南區, 臺中市", "140號")]);
    const geocode = createGeocoder({ fetcher, sleep });
    expect(await geocode("臺中市南區學府路146巷142號")).toMatchObject({
      location: { lat: 24.128887, lng: 120.674447 }, precision: "street",
    });
    expect(calls.map((c) => c.params.get("street"))).toEqual(["142號 學府路146巷", "學府路146巷"]);
  });

  it("全部查不到回 INVALID_INPUT；結果（含查不到）會快取，不重打外部服務", async () => {
    const { fetcher } = fakeNominatim(() => []);
    const geocode = createGeocoder({ fetcher, sleep });
    await expect(geocode("臺中市西區不存在路1號")).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("查不到") });
    const used = fetcher.mock.calls.length;
    expect(used).toBe(3);
    await expect(geocode("台中市西區不存在路1號")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetcher.mock.calls.length).toBe(used);
  });

  it("外部服務失敗回 RETRY_LATER 且不快取，之後可重試", async () => {
    let mode: "fail" | "throw" | "ok" = "fail";
    const { fetcher } = fakeNominatim(() => mode === "ok" ? [place(24, 120, "1號, 昇平街, 西區, 臺中市", "1號")] : mode);
    const geocode = createGeocoder({ fetcher, sleep });
    await expect(geocode("臺中市西區昇平街1號")).rejects.toMatchObject({ code: "RETRY_LATER" });
    mode = "throw";
    await expect(geocode("臺中市西區昇平街1號")).rejects.toMatchObject({ code: "RETRY_LATER" });
    mode = "ok";
    expect((await geocode("臺中市西區昇平街1號")).precision).toBe("house");
  });

  it("每次請求間隔至少 minIntervalMs；排隊過多回 RETRY_LATER", async () => {
    let t = 0;
    const waits: number[] = [];
    const { fetcher } = fakeNominatim(() => []);
    const geocode = createGeocoder({
      fetcher, minIntervalMs: 1000, maxPending: 2, now: () => t,
      sleep: async (ms) => { waits.push(ms); t += ms; },
    });
    const first = geocode("A路1號");
    const second = geocode("B路1號");
    await expect(geocode("C路1號")).rejects.toMatchObject({ code: "RETRY_LATER", message: expect.stringContaining("太多") });
    await Promise.allSettled([first, second]);
    // 兩筆地址的請求依序執行：第一次不用等，之後每次都等滿間隔
    expect(waits.length).toBe(fetcher.mock.calls.length - 1);
    expect(waits.every((w) => w === 1000)).toBe(true);
  });

  it.each([undefined, 123, "abc", "址".repeat(101)])("輸入檢查：%s", async (input) => {
    const { fetcher } = fakeNominatim(() => []);
    await expect(createGeocoder({ fetcher, sleep })(input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
