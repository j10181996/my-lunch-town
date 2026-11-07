import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { noopEvents } from "../context";
import { asyncDb, openDb, SAMPLE_SEED } from "../db";
import { inject } from "./inject";

/** Node 與 Worker 共用的請求前處理（server/api.ts 的 readApiRequest）與回應格式。 */
describe("API 請求處理", () => {
  const app = buildApp({ ctx: { db: asyncDb(openDb(":memory:", SAMPLE_SEED)), events: noopEvents } });

  it("第一次請求發 HttpOnly 工作階段 Cookie，帶著 Cookie 就不再發", async () => {
    const first = await inject(app, { url: "/api/town" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["set-cookie"]).toMatch(/^lt_sid=[a-z0-9]{24}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    const cookie = first.headers["set-cookie"]!.split(";")[0];
    expect((await inject(app, { url: "/api/town", headers: { cookie } })).headers["set-cookie"]).toBeUndefined();
  });

  it("secureCookie 時 Cookie 帶 Secure", async () => {
    const secure = buildApp({ ctx: { db: asyncDb(openDb(":memory:", SAMPLE_SEED)), events: noopEvents }, secureCookie: true });
    expect((await inject(secure, { url: "/api/town" })).headers["set-cookie"]).toMatch(/; Secure$/);
  });

  it("API 回應不可快取，並帶 nosniff", async () => {
    const res = await inject(app, { url: "/api/town" });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("外站 Origin 的寫入被擋下；同站與沒有 Origin 的請求照常處理", async () => {
    const payload = { title: "測試", nickname: "團主", requestId: crypto.randomUUID(), storeIds: ["store-af"] };
    const foreign = await inject(app, { method: "POST", url: "/api/rooms", payload, headers: { origin: "https://evil.example" } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toEqual({ code: "NOT_ALLOWED", message: "請從本站操作" });
    const same = await inject(app, { method: "POST", url: "http://localhost/api/rooms", payload, headers: { origin: "http://localhost" } });
    expect(same.statusCode).toBe(200);
  });

  it("body 格式錯誤或過大回 INVALID_INPUT", async () => {
    const bad = await inject(app, { method: "POST", url: "/api/stores", payload: "{", headers: { "content-type": "application/json" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ code: "INVALID_INPUT", message: "請求格式錯誤" });
    const big = await inject(app, { method: "POST", url: "/api/stores", payload: { name: "x".repeat(70_000) } });
    expect(big.statusCode).toBe(400);
    expect(big.json()).toEqual({ code: "INVALID_INPUT", message: "請求內容過大" });
  });

  it("不存在的 API 回 404 與錯誤格式", async () => {
    const res = await inject(app, { url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "INVALID_INPUT", message: "找不到這個 API" });
  });

  it("路徑參數會解碼：store%2Daf 對應到既有店家 store-af", async () => {
    const encoded = await inject(app, { url: "/api/stores/store%2Daf" });
    const plain = await inject(app, { url: "/api/stores/store-af" });
    expect(encoded.statusCode).toBe(plain.statusCode);
    expect(encoded.json()).toEqual(plain.json());
    expect((await inject(app, { url: "/api/stores/store-missing" })).json()).not.toEqual(plain.json());
  });
});
