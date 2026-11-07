import type { ImageStorage } from "./images/images";
import type { Db } from "./db";

export interface RoomEvents {
  roomChanged(roomId: string, revision: number): void;
  storeOrdersChanged(storeId: string): void;
  bubble(roomId: string, memberId: string, text: string): void;
}

export interface Ctx {
  db: Db;
  events: RoomEvents;
  images?: ImageStorage;
}

export const noopEvents: RoomEvents = {
  roomChanged() {},
  bubble() {},
  storeOrdersChanged() {},
};
