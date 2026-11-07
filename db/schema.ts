import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A versioned SQLite image preserves the original synchronous domain transactions.
// D1 compare-and-swap serializes writes across Worker isolates; stale writes retry.
export const appState = sqliteTable("app_state", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
});

export const livePresence = sqliteTable("live_presence", {
  roomId: text("room_id").notNull(),
  memberId: text("member_id").notNull(),
  clientId: text("client_id").notNull(),
  payload: text("payload"),
  seenAt: integer("seen_at").notNull(),
}, (table) => [primaryKey({ columns: [table.roomId, table.memberId, table.clientId] })]);
