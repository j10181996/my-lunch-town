import { Hono, type Context } from "hono";
import type { Ctx } from "./context";
import { AppError, err } from "./db-shared";
import { geocodeAddress } from "./geocode";
import { readMealImage, uploadMealImage } from "./images/images";
import { changeQuantity, closeRoom, exportOrder, getOwnerSummary } from "./orders/orders";
import { listStoreOrders, updateStoreOrderStatus } from "./orders/storeOrders";
import { expireRoom, setDeadline } from "./rooms/deadline";
import { myRooms } from "./rooms/history";
import { setLunchReady } from "./rooms/party";
import { confirmPayment, remindUnpaid, reportPayment, sendPaymentInfo, setPaymentInfo } from "./rooms/payments";
import { buildSnapshot, createRoom, getPublicInfo, joinRoom } from "./rooms/rooms";
import { recommendMeal, sendEmote, setSocial } from "./rooms/social";
import { likeStore, storeLikes } from "./stores/likes";
import { listManagementStores } from "./stores/store-list";
import {
  addMeal, claimStore, createStore, deleteMeal, getStore, getTown, moveMeal, myStores,
  setDelivery, setHours, setLocation, setStatus, updateMeal, updateStore,
} from "./stores/stores";
import { getTownCatalog } from "./stores/town-catalog";
import { randomId } from "./util";

export const SESSION_COOKIE = "lt_sid";
const SID_RE = /^[a-z0-9]{24}$/;
const MAX_BODY_BYTES = 65_536;
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const MEAL_IMAGES_PREFIX = "/api/meal-images/";

/** 每個請求由執行環境（Node 的 app.ts、Worker 的 index.ts）傳入。 */
export interface ApiBindings {
  ctx: Ctx;
  sid: string;
  body: unknown;
  /** 展示用後台碼：輸入後一次認領所有種子店家；未設定或空字串則停用。 */
  demoKey?: string;
}
type C = Context<{ Bindings: ApiBindings }>;

export interface ApiRequest { sid: string; body: unknown; setCookie?: string }

/**
 * 兩個執行環境共用的請求前處理：擋下外站 Origin 的寫入、取得或建立 Cookie 工作階段、讀取 JSON body。
 * 只在外層呼叫一次；body 讀完後以 ApiBindings 傳給 api，路由不再讀取 request。
 */
export async function readApiRequest(request: Request, { secureCookie }: { secureCookie: boolean }): Promise<ApiRequest> {
  const url = new URL(request.url);
  const write = request.method !== "GET" && request.method !== "HEAD";
  if (write) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw err.notAllowed("請從本站操作");
  }
  const existing = request.headers.get("cookie")?.match(/(?:^|;\s*)lt_sid=([^;]+)/)?.[1];
  const sid = existing && SID_RE.test(existing) ? existing : randomId(24);
  // 餐點圖片可被快取，不發 Cookie。
  const setCookie = sid === existing || url.pathname.startsWith(MEAL_IMAGES_PREFIX) ? undefined
    : `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secureCookie ? "; Secure" : ""}`;
  let body: unknown = {};
  if (write) {
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw err.invalid("請求內容過大");
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw err.invalid("請求內容過大");
    try { body = text ? JSON.parse(text) : {}; } catch { throw err.invalid("請求格式錯誤"); }
  }
  return { sid, body, setCookie };
}

/** API 錯誤一律回 { code, message }；非預期錯誤記錄後回 fallback。 */
export function errorResponse(error: unknown, fallback = { status: 500, message: "伺服器發生錯誤" }): Response {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };
  if (error instanceof AppError) return new Response(JSON.stringify({ code: error.code, message: error.message }), { status: error.status, headers });
  console.error("API failure", error);
  return new Response(JSON.stringify({ code: "RETRY_LATER", message: fallback.message }), { status: fallback.status, headers });
}

/** 在 api 的回應附上工作階段 Cookie。 */
export function withSessionCookie(response: Response, setCookie?: string): Response {
  if (!setCookie) return response;
  const copy = new Response(response.body, response);
  copy.headers.append("set-cookie", setCookie);
  return copy;
}

const sid = (c: C) => c.env.sid;
const body = (c: C) => c.env.body as never;
const field = (c: C, key: string) => (c.env.body as Record<string, unknown> | undefined)?.[key];

/**
 * 唯一的 API 路由表，Node 與 Worker 共用。
 * 路由只透過 c.env 取得 ctx、sid、body，不讀 request body，也不依賴執行環境。
 */
export const api = new Hono<{ Bindings: ApiBindings }>();

api.use("*", async (c, next) => {
  if (!c.req.path.startsWith(MEAL_IMAGES_PREFIX)) {
    c.env.ctx.db.prepare("INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)").run(sid(c), Date.now());
  }
  await next();
  if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "private, no-store");
  c.res.headers.set("x-content-type-options", "nosniff");
});
api.onError((error) => errorResponse(error));
api.notFound(() => errorResponse(new AppError("INVALID_INPUT", 404, "找不到這個 API")));

const db = (c: C) => c.env.ctx.db;
const ctx = (c: C) => c.env.ctx;
const id = (c: C) => c.req.param("id")!;
const storeId = (c: C) => c.req.param("storeId")!;
const mealId = (c: C) => c.req.param("mealId")!;

// —— 社交與派對 ——
api.get("/api/management/stores", (c) => c.json({ scope: "all", stores: listManagementStores(db(c), sid(c)) }));
api.post("/api/rooms/:id/emote", (c) => c.json(sendEmote(ctx(c), sid(c), id(c), body(c))));
api.post("/api/rooms/:id/recommend", (c) => c.json(recommendMeal(ctx(c), sid(c), id(c), body(c))));
api.post("/api/rooms/:id/like", (c) => c.json(likeStore(ctx(c), sid(c), id(c), body(c))));
api.put("/api/rooms/:id/social", (c) => c.json(setSocial(ctx(c), sid(c), id(c), body(c))));
api.put("/api/rooms/:id/lunch-ready", (c) => c.json(setLunchReady(ctx(c), sid(c), id(c), body(c))));

// —— 團購 ——
api.post("/api/rooms", (c) => c.json(createRoom(ctx(c), sid(c), body(c))));
api.get("/api/rooms/:id/public", (c) => c.json(getPublicInfo(db(c), id(c))));
api.post("/api/rooms/:id/join", (c) => c.json(joinRoom(ctx(c), sid(c), id(c), body(c))));
api.get("/api/rooms/:id/snapshot", (c) => c.json(buildSnapshot(db(c), id(c), sid(c))));
api.post("/api/rooms/:id/order-delta", (c) => c.json(changeQuantity(ctx(c), sid(c), id(c), body(c))));
api.post("/api/rooms/:id/close", (c) => c.json(closeRoom(ctx(c), sid(c), id(c), field(c, "requestId"))));
api.put("/api/rooms/:id/deadline", (c) => c.json(setDeadline(ctx(c), sid(c), id(c), body(c))));
api.post("/api/rooms/:id/expire", (c) => c.json(expireRoom(ctx(c), sid(c), id(c))));
api.get("/api/rooms/:id/summary", (c) => c.json(getOwnerSummary(db(c), sid(c), id(c))));
api.get("/api/rooms/:id/export", (c) =>
  c.text(exportOrder(db(c), sid(c), id(c)), 200, { "content-type": "text/plain; charset=utf-8" }));

// —— 收款 ——
api.put("/api/rooms/:id/payment-info", (c) => c.json(setPaymentInfo(ctx(c), sid(c), id(c), body(c))));
api.post("/api/rooms/:id/payment-info/send", (c) => c.json(sendPaymentInfo(ctx(c), sid(c), id(c))));
api.post("/api/rooms/:id/payment/remind", (c) => c.json(remindUnpaid(ctx(c), sid(c), id(c))));
api.post("/api/rooms/:id/payment/report", (c) => c.json(reportPayment(ctx(c), sid(c), id(c))));
api.post("/api/rooms/:id/payment/:memberId/confirm", (c) =>
  c.json(confirmPayment(ctx(c), sid(c), id(c), c.req.param("memberId")!, body(c))));

// —— 餐點圖片 ——
api.post("/api/stores/:storeId/images", async (c) => c.json(await uploadMealImage(ctx(c), sid(c), storeId(c), body(c))));
api.get("/api/meal-images/:imageId", async (c) => {
  const bytes = await readMealImage(ctx(c), c.req.param("imageId")!);
  return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
    "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable",
  });
});

// —— 店家 ——
api.put("/api/stores/:storeId/hours", (c) => c.json(setHours(db(c), sid(c), storeId(c), body(c))));
api.put("/api/stores/:storeId/delivery", (c) => c.json(setDelivery(db(c), sid(c), storeId(c), body(c))));
api.put("/api/stores/:storeId/location", (c) => c.json(setLocation(db(c), sid(c), storeId(c), body(c))));
// GET：Worker 不寫回快照，衝突重試也不會重複打外部服務。
api.get("/api/geocode/:address", async (c) => c.json(await geocodeAddress(c.req.param("address")!)));
api.get("/api/stores/:storeId/likes", (c) => c.json(storeLikes(db(c), sid(c), storeId(c))));
api.get("/api/stores/:storeId/orders", (c) => c.json(listStoreOrders(db(c), sid(c), storeId(c))));
api.post("/api/stores/:storeId/orders/:orderId/status", (c) =>
  c.json(updateStoreOrderStatus(ctx(c), sid(c), storeId(c), c.req.param("orderId")!, body(c))));
api.get("/api/town", (c) => c.json(getTown(db(c))));
api.get("/api/town/catalog", (c) => c.json(getTownCatalog(db(c))));
api.get("/api/my/stores", (c) => c.json(myStores(db(c), sid(c))));
api.get("/api/my/rooms", (c) => c.json(myRooms(db(c), sid(c))));
api.post("/api/stores", (c) => c.json(createStore(db(c), sid(c), body(c))));
api.post("/api/stores/claim", (c) => c.json(claimStore(db(c), sid(c), field(c, "manageKey"), c.env.demoKey)));
api.get("/api/stores/:storeId", (c) => c.json(getStore(db(c), sid(c), storeId(c))));
api.patch("/api/stores/:storeId", (c) => c.json(updateStore(db(c), sid(c), storeId(c), body(c))));
api.post("/api/stores/:storeId/status", (c) => c.json(setStatus(db(c), sid(c), storeId(c), field(c, "status"))));
api.post("/api/stores/:storeId/meals", (c) => c.json(addMeal(db(c), sid(c), storeId(c), body(c))));
api.patch("/api/stores/:storeId/meals/:mealId", (c) => c.json(updateMeal(db(c), sid(c), storeId(c), mealId(c), body(c))));
api.post("/api/stores/:storeId/meals/:mealId/move", (c) =>
  c.json(moveMeal(db(c), sid(c), storeId(c), mealId(c), field(c, "direction"))));
api.delete("/api/stores/:storeId/meals/:mealId", (c) => c.json(deleteMeal(db(c), sid(c), storeId(c), mealId(c))));
