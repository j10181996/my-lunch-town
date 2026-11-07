/** Node 與 Sites 舊快照皆可補建，不改動訂單資料。 */
export const PARTY_SCHEMA = `
CREATE TABLE IF NOT EXISTS member_ready (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS room_celebrations (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  members_json TEXT NOT NULL
);`;
