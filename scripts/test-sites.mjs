import assert from "node:assert/strict";

const base = process.env.SITES_TEST_URL ?? "http://127.0.0.1:8799";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Integration fixtures must only run locally");
const id = () => crypto.randomUUID();
function client() {
  let cookie = "";
  return async (method, path, body, expected = 200) => {
    const response = await fetch(base + path, {
      method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    const result = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
}
const owner = client(), guest = client(), stranger = client(), admin = client();
const input = { title: "Sites 整合驗證", nickname: "團主", requestId: id() };
const created = await owner("POST", "/api/rooms", input);
const room = created.snapshot.room.id, root = `/api/rooms/${room}`;
assert.equal((await owner("POST", "/api/rooms", input)).snapshot.room.id, room, "create request is idempotent");
const joined = await guest("POST", root + "/join", { nickname: "團員", avatarId: "avatar-pink" });
assert.notEqual(joined.me.id, created.snapshot.me.id);
assert.equal((await guest("POST", root + "/join", { nickname: "重新加入" })).me.id, joined.me.id);
await stranger("GET", root + "/snapshot", undefined, 401);
const meal = created.snapshot.catalog.meals.find((m) => m.available);
assert(meal);
const change = { mealId: meal.id, delta: 1, requestId: id() };
await guest("POST", root + "/order-delta", change);
await guest("POST", root + "/order-delta", change);
assert.equal((await guest("GET", root + "/snapshot")).myTotalQuantity, 1);
// All requests read the same starting revision before their CAS writes race.
await Promise.all(Array.from({ length: 6 }, () => guest("POST", root + "/order-delta", { ...change, requestId: id() })));
assert.equal((await owner("GET", root + "/summary")).totalQuantity, 7, "concurrent increments are never lost");
const guestLive = { clientId: id(), move: { sceneId: "street", x: 0.4, y: 0.5, direction: "right", seq: 1 } };
const firstLive = await guest("POST", root + "/live", guestLive);
assert(firstLive.presence.players.some((p) => p.memberId === joined.me.id && p.x === 0.4));
const ownerLive = { clientId: id() };
let sync = await owner("POST", root + "/live", ownerLive);
assert(sync.presence.players.some((p) => p.memberId === joined.me.id));
await guest("POST", root + "/order-delta", { ...change, requestId: id() });
sync = await owner("POST", root + "/live", { ...ownerLive, after: sync.cursor });
assert(sync.bubbles.some((b) => b.memberId === joined.me.id));
await stranger("POST", root + "/live", { clientId: id() }, 401);
await guest("POST", root + "/live", { ...guestLive, move: { ...guestLive.move, x: 3 } }, 400);
await guest("POST", root + "/live", { ...guestLive, leave: true });
sync = await owner("POST", root + "/live", ownerLive);
assert(!sync.presence.players.some((p) => p.memberId === joined.me.id));
await guest("POST", root + "/close", { requestId: id() }, 403);
await admin("POST", "/api/stores/claim", { manageKey: `demo-${meal.storeId}` });
await guest("POST", `/api/stores/${meal.storeId}/live`, {}, 403);
const before = await admin("POST", `/api/stores/${meal.storeId}/live`, {});
const closed = await owner("POST", root + "/close", { requestId: id() });
assert.equal(closed.room.status, "closed");
assert.equal(closed.totalQuantity, 8);
await guest("POST", root + "/order-delta", { ...change, requestId: id() }, 409);
await guest("POST", root + "/order-delta", change); // same original request still returns its original acknowledgement
assert((await owner("GET", root + "/export")).includes(meal.name));
const after = await admin("POST", `/api/stores/${meal.storeId}/live`, {});
assert(after.revision > before.revision);
const orders = await admin("GET", `/api/stores/${meal.storeId}/orders`);
const order = orders.find((o) => o.roomId === room);
assert(order);
for (const status of ["accepted", "preparing", "ready"]) {
  await admin("POST", `/api/stores/${meal.storeId}/orders/${order.id}/status`, { status });
  assert.equal((await guest("GET", root + "/snapshot")).storeOrders.find((o) => o.storeId === meal.storeId).status, status);
}
await owner("PUT", root + "/payment-info", { methods: [{ type: "cash", note: "測試用現金確認" }], note: "整合測試" });
await owner("POST", root + "/payment-info/send", {});
assert.equal((await guest("GET", root + "/snapshot")).myPayment.amountTwd, meal.priceTwd * 8);
await guest("POST", root + "/payment/report", {});
await guest("POST", `${root}/payment/${joined.me.id}/confirm`, { confirmed: true }, 403);
await owner("POST", `${root}/payment/${joined.me.id}/confirm`, { confirmed: true });
assert.equal((await guest("GET", root + "/snapshot")).myPayment.status, "confirmed");
assert.equal((await owner("GET", root + "/summary")).paymentProgress.paidCount, 1);
// The running Worker upgrades an existing persisted image and filters both stores and meals.
await admin("PUT", `/api/stores/${meal.storeId}/hours`, { weekly: Array.from({ length: 7 }, () => []), cutoff: null });
const next = await owner("POST", "/api/rooms", { title: "營業時間驗證", nickname: "團主", requestId: id() });
assert(!next.snapshot.catalog.stores.some((s) => s.id === meal.storeId));
assert(!next.snapshot.catalog.meals.some((m) => m.storeId === meal.storeId));
assert.equal((await guest("GET", root + "/snapshot")).totalQuantity, 8);
await guest("PUT", `/api/stores/${meal.storeId}/hours`, null, 403);
await admin("PUT", `/api/stores/${meal.storeId}/hours`, null);
await owner("POST", root + "/live", { ...ownerLive, leave: true });
console.log("Sites integration passed: sessions, permissions, idempotency, 6 concurrent writes, presence, bubbles, close/export, store status, payment confirmation.");
console.log(`Persistence fixture: ${root}`);
