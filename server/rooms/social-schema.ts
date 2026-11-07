import type { Db } from "../db";

/** Node 與 Sites 舊快照皆可套用；不改動既有訂單資料。 */
export const SOCIAL_SCHEMA = `CREATE TABLE IF NOT EXISTS member_social (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_emote_at INTEGER NOT NULL DEFAULT 0
)`;

export function socialEnabled(db: Db, memberId: string): boolean {
  const row = db.prepare("SELECT enabled FROM member_social WHERE member_id = ?").get(memberId) as { enabled: number } | undefined;
  return row?.enabled !== 0;
}
