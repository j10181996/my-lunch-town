import type { Db } from "./db";
import type { AuthActor } from "./auth";

export interface RoomEvents {
  roomChanged(roomId: string, revision: number): void;
  storeOrdersChanged(storeId: string): void;
  bubble(roomId: string, memberId: string, text: string): void;
}

export interface Ctx {
  db: Db;
  events: RoomEvents;
  /** Sites Worker 才設定；Node 本機開發維持既有 cookie 流程。 */
  platformAuth?: boolean;
  actor?: AuthActor;
}

export const noopEvents: RoomEvents = {
  roomChanged() {},
  bubble() {},
  storeOrdersChanged() {},
};
