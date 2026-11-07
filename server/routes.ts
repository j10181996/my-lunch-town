import { uploadMealImage, readMealImage } from "./images/images";
import { setLunchReady } from "./rooms/party";
import { expireRoom, setDeadline } from "./rooms/deadline";
import { myRooms } from "./rooms/history";
import { listManagementStores } from "./stores/store-list";
import { getTownCatalog } from "./stores/town-catalog";
import { setHours } from "./stores/stores";
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

import { confirmPayment, remindUnpaid, reportPayment, sendPaymentInfo, setPaymentInfo } from "./rooms/payments";

export function registerRoutes(app: FastifyInstance, ctx: Ctx, demoKey?: string) {
  const { db } = ctx;
  type P = { id: string };
  type SP = { storeId: string; mealId: string };

  app.get("/api/management/stores", async (req) => ({
    scope: "all", stores: listManagementStores(db, req.sid),
  }));
  app.post<{ Params: P }>("/api/rooms/:id/emote", async (req) => sendEmote(ctx, req.sid, req.params.id, req.body));
  app.put<{ Params: P }>("/api/rooms/:id/social", async (req) => setSocial(ctx, req.sid, req.params.id, req.body));

  app.put<{ Params: P }>("/api/rooms/:id/lunch-ready", async (req) => setLunchReady(ctx, req.sid, req.params.id, req.body));

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
  app.put<{ Params: P }>("/api/rooms/:id/deadline", async (req) => setDeadline(ctx, req.sid, req.params.id, req.body));
  app.post<{ Params: P }>("/api/rooms/:id/expire", async (req) => expireRoom(ctx, req.sid, req.params.id));
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
  app.post<{ Params: P }>("/api/rooms/:id/payment/remind", async (req) =>
    remindUnpaid(ctx, req.sid, req.params.id),
  );
  app.post<{ Params: P }>("/api/rooms/:id/payment/report", async (req) =>
    reportPayment(ctx, req.sid, req.params.id),
  );
  app.post<{ Params: P & { memberId: string } }>("/api/rooms/:id/payment/:memberId/confirm", async (req) =>
    confirmPayment(ctx, req.sid, req.params.id, req.params.memberId, req.body),
  );

  app.put<{ Params: { storeId: string } }>("/api/stores/:storeId/hours", async (req) => setHours(db, req.sid, req.params.storeId, req.body));

  app.post<{ Params: { storeId: string } }>("/api/stores/:storeId/images", async (req) => uploadMealImage(ctx, req.sid, req.params.storeId, req.body));
  app.get<{ Params: { imageId: string } }>("/api/meal-images/:imageId", async (req, reply) => reply.type("image/png").send(await readMealImage(ctx, req.params.imageId)));

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
  app.get("/api/town/catalog", async () => getTownCatalog(db));
  app.get("/api/my/stores", async (req) => myStores(db, req.sid));
  app.get("/api/my/rooms", async (req) => myRooms(db, req.sid));
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

}
