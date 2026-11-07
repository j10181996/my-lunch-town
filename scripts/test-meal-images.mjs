import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
const base = process.env.SITES_TEST_URL ?? "http://127.0.0.1:8799";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "圖片測試只能對本機執行");
function client() {
  let cookie = "";
  return async (method, path, body, expected = 200) => {
    const response = await fetch(base + path, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get("set-cookie"); if (setCookie) cookie = setCookie.split(";")[0];
    const result = response.headers.get("content-type")?.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
}
const shop = client(), stranger = client(), owner = client();
const town = await shop("GET", "/api/town"); const store = town.find((p) => p.store)?.store;
const profile = await shop("POST", "/api/stores/claim", { manageKey: `demo-${store.id}` });
const meal = profile.meals.find((m) => m.available);
const pixels = Array.from({ length: 4096 }, (_, i) => i % 4 === 3 ? 255 : i % 256);
const root = `/api/stores/${store.id}`;
await stranger("POST", root + "/images", { pixels }, 403);
await shop("POST", root + "/images", { pixels: pixels.slice(1) }, 400);
const image = await shop("POST", root + "/images", { pixels });
assert.deepEqual(await shop("POST", root + "/images", { pixels }), image);
const bytes = await owner("GET", `/api/meal-images/${image.imageAssetKey}`);
assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
const view = new DataView(bytes.buffer); assert.equal(view.getUint32(16), 32); assert.equal(view.getUint32(20), 32);
let offset = 8; const compressed = [];
while (offset < bytes.length) {
  const size = view.getUint32(offset); if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "IDAT") compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
  offset += size + 12;
}
assert.equal(inflateSync(Buffer.concat(compressed)).length, 32 * 129);
await shop("PATCH", `${root}/meals/${meal.id}`, { imageAssetKey: image.imageAssetKey });
const first = await owner("POST", "/api/rooms", { title: "圖片快照驗證", nickname: "團主", storeIds: [store.id], requestId: crypto.randomUUID() });
assert.equal(first.snapshot.catalog.meals.find((m) => m.id === meal.id).imageAssetKey, image.imageAssetKey);
const secondPixels = [...pixels]; secondPixels[0] = 255;
const second = await shop("POST", root + "/images", { pixels: secondPixels });
assert.notEqual(second.imageAssetKey, image.imageAssetKey);
await shop("PATCH", `${root}/meals/${meal.id}`, { imageAssetKey: second.imageAssetKey });
const snapshot = await owner("GET", `/api/rooms/${first.snapshot.room.id}/snapshot`);
assert.equal(snapshot.catalog.meals.find((m) => m.id === meal.id).imageAssetKey, image.imageAssetKey);
assert.deepEqual(await owner("GET", `/api/meal-images/${image.imageAssetKey}`), bytes);
const other = town.find((p) => p.store && p.store.id !== store.id).store;
const otherProfile = await shop("POST", "/api/stores/claim", { manageKey: `demo-${other.id}` });
await shop("PATCH", `/api/stores/${other.id}/meals/${otherProfile.meals[0].id}`, { imageAssetKey: image.imageAssetKey }, 403);
console.log("圖片整合測試通過：R2 寫讀、PNG 解碼、同圖去重、跨店拒絕、換圖與舊團快照保留");
console.log(JSON.stringify({ imageAssetKey: image.imageAssetKey, roomId: first.snapshot.room.id }));
