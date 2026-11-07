import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import type { Ctx } from "./context";
import { AppError } from "./db";
import { randomId } from "./util";
import { createRoom, buildSnapshot, getPublicInfo, joinRoom } from "./rooms/rooms";
import { changeQuantity, closeRoom, exportOrder, getOwnerSummary } from "./orders/orders";
import {
  addMeal,
  claimStore,
  createStore,
  deleteMeal,
  getStore,
  getTown,
  moveMeal,
  myStores,
  setStatus,
  setDelivery,
  updateMeal,
  updateStore,
} from "./stores/stores";

import { listStoreOrders, updateStoreOrderStatus } from "./orders/storeOrders";

import { confirmPayment, reportPayment, sendPaymentInfo, setPaymentInfo } from "./rooms/payments";

export const SESSION_COOKIE = "lt_sid";
const SID_RE = /^[a-z0-9]{24}$/;

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

export interface AppOptions {
  ctx: Ctx;
  staticDir?: string;
  secureCookie?: boolean;
  /** 展示用後台碼：輸入後一次認領所有種子店家；未設定或空字串則停用。 */
  demoKey?: string;
}

export async function buildApp({ ctx, staticDir, secureCookie = false, demoKey }: AppOptions) {
  const app = Fastify({ logger: false });
  const { db } = ctx;
  await app.register(cookie);

  app.decorateRequest("sid", "");
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    let sid = req.cookies[SESSION_COOKIE];
    if (!sid || !SID_RE.test(sid)) {
      sid = randomId(24);
      reply.setCookie(SESSION_COOKIE, sid, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookie,
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    db.prepare("INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)").run(sid, Date.now());
    req.sid = sid;
  });

  app.setErrorHandler((error: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ code: error.code, message: error.message });
    }
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(400).send({ code: "INVALID_INPUT", message: "請求格式錯誤" });
    }
    console.error(error);
    return reply.status(500).send({ code: "RETRY_LATER", message: "伺服器發生錯誤" });
  });

  type P = { id: string };
  type SP = { storeId: string; mealId: string };

  // —— 團購 ——
  app.post("/api/rooms", async (req) => createRoom(ctx, req.sid, req.body as never));
  app.get<{ Params: P }>("/api/rooms/:id/public", async (req) => getPublicInfo(db, req.params.id));
  app.post<{ Params: P }>("/api/rooms/:id/join", async (req) => joinRoom(ctx, req.sid, req.params.id, req.body as never));
  app.get<{ Params: P }>("/api/rooms/:id/snapshot", async (req) => buildSnapshot(db, req.params.id, req.sid));
  app.post<{ Params: P }>("/api/rooms/:id/order-delta", async (req) =>
    changeQuantity(ctx, req.sid, req.params.id, req.body as never),
  );
  app.post<{ Params: P }>("/api/rooms/:id/close", async (req) =>
    closeRoom(ctx, req.sid, req.params.id, (req.body as { requestId?: unknown } | undefined)?.requestId),
  );
  app.get<{ Params: P }>("/api/rooms/:id/summary", async (req) => getOwnerSummary(db, req.sid, req.params.id));
  app.get<{ Params: P }>("/api/rooms/:id/export", async (req, reply) => {
    const textOut = exportOrder(db, req.sid, req.params.id);
    return reply.type("text/plain; charset=utf-8").send(textOut);
  });

  app.put<{ Params: P }>("/api/rooms/:id/payment-info", async (req) =>
    setPaymentInfo(ctx, req.sid, req.params.id, req.body),
  );
  app.post<{ Params: P }>("/api/rooms/:id/payment-info/send", async (req) =>
    sendPaymentInfo(ctx, req.sid, req.params.id),
  );
  app.post<{ Params: P }>("/api/rooms/:id/payment/report", async (req) =>
    reportPayment(ctx, req.sid, req.params.id),
  );
  app.post<{ Params: P & { memberId: string } }>("/api/rooms/:id/payment/:memberId/confirm", async (req) =>
    confirmPayment(ctx, req.sid, req.params.id, req.params.memberId, req.body),
  );

  // —— 店家 ——
  app.put<{ Params: { storeId: string } }>("/api/stores/:storeId/delivery", async (req) =>
    setDelivery(db, req.sid, req.params.storeId, req.body),
  );
  app.get<{ Params: { storeId: string } }>("/api/stores/:storeId/orders", async (req) =>
    listStoreOrders(db, req.sid, req.params.storeId),
  );
  app.post<{ Params: { storeId: string; orderId: string } }>(
    "/api/stores/:storeId/orders/:orderId/status", async (req) =>
      updateStoreOrderStatus(ctx, req.sid, req.params.storeId, req.params.orderId, req.body as never),
  );
  app.get("/api/town", async () => getTown(db));
  app.get("/api/my/stores", async (req) => myStores(db, req.sid));
  app.post("/api/stores", async (req) => createStore(db, req.sid, req.body as never));
  app.post("/api/stores/claim", async (req) =>
    claimStore(db, req.sid, (req.body as { manageKey?: unknown } | undefined)?.manageKey, demoKey),
  );
  app.get<{ Params: { storeId: string } }>("/api/stores/:storeId", async (req) => getStore(db, req.sid, req.params.storeId));
  app.patch<{ Params: { storeId: string } }>("/api/stores/:storeId", async (req) =>
    updateStore(db, req.sid, req.params.storeId, req.body as never),
  );
  app.post<{ Params: { storeId: string } }>("/api/stores/:storeId/status", async (req) =>
    setStatus(db, req.sid, req.params.storeId, (req.body as { status?: unknown } | undefined)?.status),
  );
  app.post<{ Params: { storeId: string } }>("/api/stores/:storeId/meals", async (req) =>
    addMeal(db, req.sid, req.params.storeId, req.body as never),
  );
  app.patch<{ Params: SP }>("/api/stores/:storeId/meals/:mealId", async (req) =>
    updateMeal(db, req.sid, req.params.storeId, req.params.mealId, req.body as never),
  );
  app.post<{ Params: SP }>("/api/stores/:storeId/meals/:mealId/move", async (req) =>
    moveMeal(db, req.sid, req.params.storeId, req.params.mealId, (req.body as { direction?: unknown } | undefined)?.direction),
  );
  app.delete<{ Params: SP }>("/api/stores/:storeId/meals/:mealId", async (req) =>
    deleteMeal(db, req.sid, req.params.storeId, req.params.mealId),
  );

  // —— 正式環境：同一網址供應前端 ——
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/socket.io")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ code: "INVALID_INPUT", message: "找不到" });
    });
  }

  return app;
}
