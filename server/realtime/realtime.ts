import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Direction, MoveInput, PlayerPresence, PresenceSnapshot } from "../../shared/contracts";
import type { RoomEvents } from "../context";
import { isBadgeId } from "../../shared/social";
import { requireOwner } from "../stores/stores";
import { AppError } from "../db";
import type { Db } from "../db";
import { findMember, getRoomRow } from "../rooms/rooms";
import { SESSION_COOKIE } from "../app";

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
const MIN_MOVE_INTERVAL_MS = 80; // 約每秒 10 次
const BROADCAST_INTERVAL_MS = 100;

interface SocketData {
  sid: string;
  roomId?: string;
  memberId?: string;
  storeIds?: Set<string>;
  lastMoveAt: number;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function validMove(input: unknown): MoveInput | null {
  const m = input as Partial<MoveInput> | null;
  if (!m || typeof m !== "object") return null;
  if (typeof m.sceneId !== "string" || !(m.sceneId === "street" || /^shop:[\w-]{1,40}$/.test(m.sceneId))) return null;
  if (typeof m.x !== "number" || typeof m.y !== "number" || !(m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1)) return null;
  if (!DIRECTIONS.includes(m.direction as Direction)) return null;
  if (typeof m.seq !== "number" || !Number.isInteger(m.seq)) return null;
  if (m.accessory !== undefined && !["none", "flower", "leaf", "cap"].includes(m.accessory)) return null;
  if (m.badge !== undefined && !isBadgeId(m.badge)) return null;
  return { accessory: m.accessory, badge: m.badge, sceneId: m.sceneId as MoveInput["sceneId"], x: m.x, y: m.y, direction: m.direction as Direction, seq: m.seq };
}

/** 角色位置只存記憶體；訂單變更只透過 room:changed 通知，資料以 HTTP snapshot 為準。 */
export function attachRealtime(httpServer: HttpServer, db: Db): RoomEvents {
  const io = new Server(httpServer, { path: "/socket.io", serveClient: false });
  /** roomId → memberId → presence */
  const presence = new Map<string, Map<string, PlayerPresence>>();
  /** roomId:memberId → 連線數（同一人多分頁） */
  const connections = new Map<string, number>();
  const dirty = new Set<string>();

  io.use((socket, next) => {
    const sid = parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    if (!sid) return next(new Error("SESSION_REQUIRED"));
    (socket.data as SocketData) = { sid, lastMoveAt: 0 };
    next();
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;

    socket.on("room:subscribe", async (roomId: unknown, ack?: (r: { ok: boolean; code?: string }) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (typeof roomId !== "string" || data.roomId) return reply({ ok: false, code: "INVALID_INPUT" });
      try {
        await getRoomRow(db, roomId);
      } catch {
        return reply({ ok: false, code: "ROOM_NOT_FOUND" });
      }
      const me = await findMember(db, roomId, data.sid);
      // 等待查詢期間可能已斷線（斷線處理不會再清理這筆）或已訂閱其他團，都不能再加入與計數。
      if (!socket.connected) return;
      if (data.roomId) return reply({ ok: false, code: "INVALID_INPUT" });
      if (!me) return reply({ ok: false, code: "SESSION_REQUIRED" });
      data.roomId = roomId;
      data.memberId = me.id;
      socket.join(roomId);
      const key = `${roomId}:${me.id}`;
      connections.set(key, (connections.get(key) ?? 0) + 1);
      reply({ ok: true });
      socket.emit("presence:snapshot", snapshotOf(roomId));
    });

    socket.on("store:subscribe", async (storeId: unknown, ack?: (r: { ok: boolean; code?: string }) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (typeof storeId !== "string") return reply({ ok: false, code: "INVALID_INPUT" });
      try {
        await requireOwner(db, data.sid, storeId);
        if (!socket.connected) return; // 查詢期間已斷線
        (data.storeIds ??= new Set()).add(storeId);
        socket.join(`store:${storeId}`);
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, code: e instanceof AppError ? e.code : "RETRY_LATER" });
      }
    });

    socket.on("player:move", (input: unknown) => {
      if (!data.roomId || !data.memberId) return;
      const now = Date.now();
      if (now - data.lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
      const move = validMove(input);
      if (!move) return;
      data.lastMoveAt = now;
      let room = presence.get(data.roomId);
      if (!room) presence.set(data.roomId, (room = new Map()));
      room.set(data.memberId, { memberId: data.memberId, ...move });
      dirty.add(data.roomId);
    });

    socket.on("disconnect", () => {
      if (!data.roomId || !data.memberId) return;
      const key = `${data.roomId}:${data.memberId}`;
      const n = (connections.get(key) ?? 1) - 1;
      if (n > 0) {
        connections.set(key, n);
        return;
      }
      connections.delete(key);
      presence.get(data.roomId)?.delete(data.memberId);
      dirty.add(data.roomId);
    });
  });

  function snapshotOf(roomId: string): PresenceSnapshot {
    return { roomId, players: [...(presence.get(roomId)?.values() ?? [])] };
  }

  setInterval(() => {
    for (const roomId of dirty) io.to(roomId).emit("presence:snapshot", snapshotOf(roomId));
    dirty.clear();
  }, BROADCAST_INTERVAL_MS).unref();

  return {
    roomChanged(roomId, revision) {
      io.to(roomId).emit("room:changed", { roomId, revision });
    },
    storeOrdersChanged(storeId) {
      // 認領可能改變擁有者；既有連線每次通知前也重新核對權限，核對完才推送。
      void (async () => {
        for (const socket of io.sockets.sockets.values()) {
          const data = socket.data as SocketData;
          if (!data.storeIds?.has(storeId)) continue;
          try {
            await requireOwner(db, data.sid, storeId);
          } catch {
            socket.leave(`store:${storeId}`);
            data.storeIds.delete(storeId);
          }
        }
        io.to(`store:${storeId}`).emit("store:orders-changed", { storeId });
      })().catch((e) => console.error("店家訂單通知失敗", e));
    },
    bubble(roomId, memberId, text) {
      io.to(roomId).emit("player:bubble", { memberId, text });
    },
  };
}
