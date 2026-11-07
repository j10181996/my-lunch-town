import type { CreatedStoreInvite, StoreInvite } from "../../shared/auth";
import { err, hashKey, withWriteTx, type Db } from "../db";
import { intInRange, randomId, text } from "../util";

interface InviteRow {
  id: string;
  store_id: string;
  target_user_id: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
}

function present(row: InviteRow): StoreInvite {
  return {
    id: row.id,
    storeId: row.store_id,
    targetUserId: row.target_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

export function listStoreInvites(db: Db): StoreInvite[] {
  return (db.prepare(`SELECT id, store_id, target_user_id, expires_at, accepted_at, revoked_at
    FROM store_invites ORDER BY created_at DESC`).all() as unknown as InviteRow[]).map(present);
}

export function createStoreInvite(
  db: Db,
  actorSessionId: string,
  input: { storeId?: unknown; targetUserId?: unknown; expiresInDays?: unknown },
): CreatedStoreInvite {
  const storeId = text(input?.storeId, "店家", 1, 80);
  // Stable ChatGPT identity strings are opaque; do not impose a provider-specific format.
  const targetUserId = text(input?.targetUserId, "ChatGPT 使用者 ID", 1, 200);
  const days = input?.expiresInDays === undefined ? 7 : intInRange(input.expiresInDays, "邀請有效天數", 1, 30);
  if (!db.prepare("SELECT id FROM stores WHERE id = ?").get(storeId)) throw err.invalid("找不到這家店");
  const now = Date.now();
  const token = `lti_${randomId(32)}`;
  const row: InviteRow = {
    id: `invite-${randomId(12)}`,
    store_id: storeId,
    target_user_id: targetUserId,
    expires_at: now + days * 86_400_000,
    accepted_at: null,
    revoked_at: null,
  };
  db.prepare(`INSERT INTO store_invites
    (id, store_id, target_user_id, token_hash, created_by_session_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, storeId, targetUserId, hashKey(token), actorSessionId, now, row.expires_at);
  return { ...present(row), token };
}

export function acceptStoreInvite(db: Db, token: unknown, userId: string, sessionId: string): StoreInvite {
  const rawToken = text(token, "邀請連結", 12, 128);
  return withWriteTx(db, () => {
    const row = db.prepare(`SELECT id, store_id, target_user_id, expires_at, accepted_at, revoked_at
      FROM store_invites WHERE token_hash = ?`).get(hashKey(rawToken)) as InviteRow | undefined;
    const now = Date.now();
    if (!row || row.target_user_id !== userId || row.revoked_at || row.accepted_at || row.expires_at <= now) {
      throw err.notAllowed("邀請無效、已使用或已過期");
    }
    db.prepare("INSERT OR IGNORE INTO store_managers (store_id, session_id, created_at) VALUES (?, ?, ?)")
      .run(row.store_id, sessionId, now);
    db.prepare("UPDATE store_invites SET accepted_at = ?, accepted_by_session_id = ? WHERE id = ?")
      .run(now, sessionId, row.id);
    row.accepted_at = now;
    return present(row);
  });
}

export function revokeStoreInvite(db: Db, inviteId: string) {
  const changed = db.prepare("UPDATE store_invites SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL")
    .run(Date.now(), inviteId).changes;
  if (changed === 0) throw err.invalid("找不到可撤銷的邀請");
}
