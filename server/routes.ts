import { sendEmote, setSocial } from "./rooms/social";
import type { FastifyInstance } from "fastify";
import type { Ctx } from "./context";
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
import { authPaths, requireActor, requireAdmin, requireInternalMember } from "./auth";
import { acceptStoreInvite, createStoreInvite, listStoreInvites, revokeStoreInvite } from "./stores/invites";
import { managerStoreIds, removeStoreManager } from "./stores/stores";
import { sessionIdForUser } from "./auth";
import { err } from "./db";

export function registerRoutes(app: FastifyInstance, ctx: Ctx, demoKey?: string) {
  const { db } = ctx;
  type P = { id: string };
  type SP = { storeId: string; mealId: string };
  const sid = (request: { sid: string }) => requireActor(ctx)?.sessionId ?? request.sid;

  // ChatGPT Sites 身分狀態。這是唯一允許未加入內部平台的讀取 API，
  // 讓受邀店家能確認自己的 opaque user ID 並兌換邀請連結。
  app.get("/api/auth/session", async (req) => {
    const actor = ctx.actor;
    if (!ctx.platformAuth) {
      return { authenticated: false, user: null, member: true, admin: true, storeIds: managerStoreIds(db, req.sid), ...authPaths() };
    }
    return {
      authenticated: !!actor,
      user: actor ? { id: actor.userId, email: actor.email, name: actor.name } : null,
      member: actor?.isMember ?? false,
      admin: actor?.isAdmin ?? false,
      storeIds: actor ? managerStoreIds(db, actor.sessionId) : [],
      ...authPaths(),
    };
  });

  app.post<{ Params: P }>("/api/rooms/:id/emote", async (req) => sendEmote(ctx, req.sid, req.params.id, req.body));
  app.put<{ Params: P }>("/api/rooms/:id/social", async (req) => setSocial(ctx, req.sid, req.params.id, req.body));

  // —— 團購 ——
  app.post("/api/rooms", async (req) => { requireInternalMember(ctx); return createRoom(ctx, sid(req), req.body as never); });
  app.get<{ Params: P }>("/api/rooms/:id/public", async (req) => { requireInternalMember(ctx); return getPublicInfo(db, req.params.id); });
  app.post<{ Params: P }>("/api/rooms/:id/join", async (req) => { requireInternalMember(ctx); return joinRoom(ctx, sid(req), req.params.id, req.body as never); });
  app.get<{ Params: P }>("/api/rooms/:id/snapshot", async (req) => { requireInternalMember(ctx); return buildSnapshot(db, req.params.id, sid(req)); });
  app.post<{ Params: P }>("/api/rooms/:id/order-delta", async (req) =>
    (requireInternalMember(ctx), changeQuantity(ctx, sid(req), req.params.id, req.body as never)),
  );
  app.post<{ Params: P }>("/api/rooms/:id/close", async (req) =>
    (requireInternalMember(ctx), closeRoom(ctx, sid(req), req.params.id, (req.body as { requestId?: unknown } | undefined)?.requestId)),
  );
  app.get<{ Params: P }>("/api/rooms/:id/summary", async (req) => { requireInternalMember(ctx); return getOwnerSummary(db, sid(req), req.params.id); });
  app.get<{ Params: P }>("/api/rooms/:id/export", async (req, reply) => {
    requireInternalMember(ctx);
    const textOut = exportOrder(db, sid(req), req.params.id);
    return reply.type("text/plain; charset=utf-8").send(textOut);
  });

  app.put<{ Params: P }>("/api/rooms/:id/payment-info", async (req) =>
    (requireInternalMember(ctx), setPaymentInfo(ctx, sid(req), req.params.id, req.body)),
  );
  app.post<{ Params: P }>("/api/rooms/:id/payment-info/send", async (req) =>
    (requireInternalMember(ctx), sendPaymentInfo(ctx, sid(req), req.params.id)),
  );
  app.post<{ Params: P }>("/api/rooms/:id/payment/report", async (req) =>
    (requireInternalMember(ctx), reportPayment(ctx, sid(req), req.params.id)),
  );
  app.post<{ Params: P & { memberId: string } }>("/api/rooms/:id/payment/:memberId/confirm", async (req) =>
    (requireInternalMember(ctx), confirmPayment(ctx, sid(req), req.params.id, req.params.memberId, req.body)),
  );

  // —— 店家 ——
  app.put<{ Params: { storeId: string } }>("/api/stores/:storeId/delivery", async (req) =>
    (requireActor(ctx), setDelivery(db, sid(req), req.params.storeId, req.body)),
  );
  app.get<{ Params: { storeId: string } }>("/api/stores/:storeId/orders", async (req) =>
    (requireActor(ctx), listStoreOrders(db, sid(req), req.params.storeId)),
  );
  app.post<{ Params: { storeId: string; orderId: string } }>(
    "/api/stores/:storeId/orders/:orderId/status", async (req) =>
      (requireActor(ctx), updateStoreOrderStatus(ctx, sid(req), req.params.storeId, req.params.orderId, req.body as never)),
  );
  app.get("/api/town", async () => { requireInternalMember(ctx); return getTown(db); });
  app.get("/api/my/stores", async (req) => { requireActor(ctx); return myStores(db, sid(req)); });
  app.post("/api/stores", async (req) => {
    requireAdmin(ctx);
    const created = createStore(db, sid(req), req.body as never);
    // 管理碼是本機 legacy 流程；Sites 的建立者已直接成為店家管理者。
    return ctx.platformAuth ? { ...created, manageKey: null } : created;
  });
  app.post("/api/stores/claim", async (req) => {
    if (ctx.platformAuth) { requireActor(ctx); throw err.notAllowed("ChatGPT Sites 僅能用店家邀請取得管理權"); }
    return claimStore(db, sid(req), (req.body as { manageKey?: unknown } | undefined)?.manageKey, demoKey);
  });
  app.get<{ Params: { storeId: string } }>("/api/stores/:storeId", async (req) => { requireActor(ctx); return getStore(db, sid(req), req.params.storeId); });
  app.patch<{ Params: { storeId: string } }>("/api/stores/:storeId", async (req) =>
    (requireActor(ctx), updateStore(db, sid(req), req.params.storeId, req.body as never)),
  );
  app.post<{ Params: { storeId: string } }>("/api/stores/:storeId/status", async (req) =>
    (requireActor(ctx), setStatus(db, sid(req), req.params.storeId, (req.body as { status?: unknown } | undefined)?.status)),
  );
  app.post<{ Params: { storeId: string } }>("/api/stores/:storeId/meals", async (req) =>
    (requireActor(ctx), addMeal(db, sid(req), req.params.storeId, req.body as never)),
  );
  app.patch<{ Params: SP }>("/api/stores/:storeId/meals/:mealId", async (req) =>
    (requireActor(ctx), updateMeal(db, sid(req), req.params.storeId, req.params.mealId, req.body as never)),
  );
  app.post<{ Params: SP }>("/api/stores/:storeId/meals/:mealId/move", async (req) =>
    (requireActor(ctx), moveMeal(db, sid(req), req.params.storeId, req.params.mealId, (req.body as { direction?: unknown } | undefined)?.direction)),
  );
  app.delete<{ Params: SP }>("/api/stores/:storeId/meals/:mealId", async (req) =>
    (requireActor(ctx), deleteMeal(db, sid(req), req.params.storeId, req.params.mealId)),
  );

  // —— 店家邀請（只由平台管理員建立與撤銷）——
  app.get("/api/store-invites", async () => { requireAdmin(ctx); return listStoreInvites(db); });
  app.post("/api/store-invites", async (req) => {
    const actor = requireAdmin(ctx);
    return createStoreInvite(db, actor?.sessionId ?? sid(req), req.body as never);
  });
  app.post("/api/store-invites/accept", async (req) => {
    const actor = requireActor(ctx);
    if (!actor) throw err.notAllowed("店家邀請僅能在 ChatGPT Sites 兌換");
    return acceptStoreInvite(db, (req.body as { token?: unknown } | undefined)?.token, actor.userId, actor.sessionId);
  });
  app.delete<{ Params: { id: string } }>("/api/store-invites/:id", async (req) => {
    requireAdmin(ctx);
    revokeStoreInvite(db, req.params.id);
    return { ok: true };
  });
  app.delete<{ Params: { storeId: string; userId: string } }>("/api/stores/:storeId/managers/:userId", async (req) => {
    requireAdmin(ctx);
    const managerSessionId = await sessionIdForUser(req.params.userId);
    removeStoreManager(db, req.params.storeId, managerSessionId);
    db.prepare(`UPDATE store_invites SET revoked_at = COALESCE(revoked_at, ?)
      WHERE store_id = ? AND target_user_id = ? AND accepted_at IS NOT NULL`).run(Date.now(), req.params.storeId, req.params.userId);
    return { ok: true };
  });

}
