import type { EmoteId } from "../../shared/social";
import * as sitesLive from "./sites-live";
import { io, type Socket } from "socket.io-client";
import type {
  CreateStoreResult,
  MoveInput,
  PaymentInfo,
  OrderAck,
  OwnerSummary,
  PlayerBubble,
  PresenceSnapshot,
  RoomChanged,
  RoomGateway,
  RoomPublicInfo,
  RoomSnapshot,
  StoreAdminGateway,
  StoreProfile,
  StoreOrder,
  TownLot,
} from "../../shared/contracts";
import { request } from "../api";

let socket: Socket | null = null;
const bubbleListeners = new Set<(b: PlayerBubble) => void>();

export interface RoomGatewayExt extends RoomGateway {
  setLunchReady(roomId: string, ready: boolean): Promise<RoomSnapshot>;
  sendEmote(roomId: string, emote: EmoteId): Promise<{ text: string }>;
  setSocial(roomId: string, enabled: boolean): Promise<{ enabled: boolean }>;
  setPaymentInfo(roomId: string, info: PaymentInfo): Promise<RoomSnapshot>;
  sendPaymentInfo(roomId: string): Promise<RoomSnapshot>;
  reportPayment(roomId: string): Promise<RoomSnapshot>;
  remindUnpaid(roomId: string): Promise<RoomSnapshot>;
  confirmPayment(roomId: string, memberId: string, confirmed: boolean): Promise<RoomSnapshot>;
  getPublicInfo(roomId: string): Promise<RoomPublicInfo>;
  onBubble(handler: (b: PlayerBubble) => void): () => void;
}

export const roomGateway: RoomGatewayExt = {
  setLunchReady: (id, ready) => request("PUT", `/api/rooms/${id}/lunch-ready`, { ready }),
  sendEmote: (id, emote) => request("POST", `/api/rooms/${id}/emote`, { emote }),
  setSocial: (id, enabled) => request("PUT", `/api/rooms/${id}/social`, { enabled }),
  setPaymentInfo: (id, info) => request("PUT", `/api/rooms/${id}/payment-info`, info),
  sendPaymentInfo: (id) => request("POST", `/api/rooms/${id}/payment-info/send`),
  reportPayment: (id) => request("POST", `/api/rooms/${id}/payment/report`),
  remindUnpaid: (id) => request("POST", `/api/rooms/${id}/payment/remind`),
  confirmPayment: (id, memberId, confirmed) =>
    request("POST", `/api/rooms/${id}/payment/${memberId}/confirm`, { confirmed }),
  createRoom: (input) => request("POST", "/api/rooms", input),
  joinRoom: (roomId, input) => request("POST", `/api/rooms/${roomId}/join`, input),
  getSnapshot: (roomId) => request<RoomSnapshot>("GET", `/api/rooms/${roomId}/snapshot`),
  getPublicInfo: (roomId) => request<RoomPublicInfo>("GET", `/api/rooms/${roomId}/public`),
  changeQuantity: (roomId, input) => request<OrderAck>("POST", `/api/rooms/${roomId}/order-delta`, input),
  closeRoom: (roomId, requestId) => request<RoomSnapshot>("POST", `/api/rooms/${roomId}/close`, { requestId }),
  getOwnerSummary: (roomId) => request<OwnerSummary>("GET", `/api/rooms/${roomId}/summary`),
  exportOrder: (roomId) => request<string>("GET", `/api/rooms/${roomId}/export`, undefined, true),

  subscribe(roomId, handlers) {
    if (import.meta.env.VITE_SITES === "1") return sitesLive.subscribeRoom(roomId, handlers);
    socket?.disconnect();
    const s = io({ path: "/socket.io", withCredentials: true });
    socket = s;
    // 每次（含第一次）訂閱成功都呼叫 onReconnect，UI 藉此重取 snapshot 並標記上線
    s.on("connect", () => {
      s.emit("room:subscribe", roomId, (r: { ok: boolean }) => {
        if (r.ok) handlers.onReconnect();
      });
    });
    s.on("disconnect", () => handlers.onDisconnect());
    s.on("room:changed", (e: RoomChanged) => handlers.onChanged(e));
    s.on("presence:snapshot", (e: PresenceSnapshot) => handlers.onPresence(e));
    s.on("player:bubble", (b: PlayerBubble) => bubbleListeners.forEach((f) => f(b)));
    return () => {
      s.disconnect();
      if (socket === s) socket = null;
    };
  },

  move(_roomId: string, input: MoveInput) {
    if (import.meta.env.VITE_SITES === "1") return sitesLive.move(_roomId, input);
    if (socket?.connected) socket.volatile.emit("player:move", input);
  },

  onBubble(handler) {
    if (import.meta.env.VITE_SITES === "1") return sitesLive.onBubble(handler);
    bubbleListeners.add(handler);
    return () => bubbleListeners.delete(handler);
  },
};

export const storeGateway: StoreAdminGateway = {
  setHours: (id, hours) => request<StoreProfile>("PUT", `/api/stores/${id}/hours`, hours),
  setDelivery: (id, rules) => request<StoreProfile>("PUT", `/api/stores/${id}/delivery`, rules),
  listOrders: (id) => request<StoreOrder[]>("GET", `/api/stores/${id}/orders`),
  updateOrderStatus: (id, orderId, input) =>
    request<StoreOrder>("POST", `/api/stores/${id}/orders/${orderId}/status`, input),
  subscribeOrders(id, onChanged) {
    if (import.meta.env.VITE_SITES === "1") return sitesLive.subscribeOrders(id, onChanged);
    const s = io({ path: "/socket.io", withCredentials: true, forceNew: true });
    s.on("connect", () => {
      s.emit("store:subscribe", id, (r: { ok: boolean }) => { if (r.ok) onChanged(); });
    });
    s.on("store:orders-changed", (e: { storeId: string }) => { if (e.storeId === id) onChanged(); });
    return () => { s.disconnect(); };
  },
  getTown: () => request<TownLot[]>("GET", "/api/town"),
  myStores: () => request<StoreProfile[]>("GET", "/api/my/stores"),
  createStore: (input) => request<CreateStoreResult>("POST", "/api/stores", input),
  claimStore: (manageKey) => request<StoreProfile>("POST", "/api/stores/claim", { manageKey }),
  getStore: (id) => request<StoreProfile>("GET", `/api/stores/${id}`),
  updateStore: (id, input) => request<StoreProfile>("PATCH", `/api/stores/${id}`, input),
  setStatus: (id, status) => request<StoreProfile>("POST", `/api/stores/${id}/status`, { status }),
  addMeal: (id, input) => request<StoreProfile>("POST", `/api/stores/${id}/meals`, input),
  updateMeal: (id, mealId, input) => request<StoreProfile>("PATCH", `/api/stores/${id}/meals/${mealId}`, input),
  moveMeal: (id, mealId, direction) => request<StoreProfile>("POST", `/api/stores/${id}/meals/${mealId}/move`, { direction }),
  deleteMeal: (id, mealId) => request<StoreProfile>("DELETE", `/api/stores/${id}/meals/${mealId}`),
};
