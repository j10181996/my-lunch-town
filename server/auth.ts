import type { Db } from "./db";
import { AppError, err } from "./db";
import type { Ctx } from "./context";

export interface AuthActor {
  /** ChatGPT Sites 提供、只在本站穩定的使用者識別碼。 */
  userId: string;
  email: string;
  name: string;
  /** 由 userId 推導，所有領域資料只使用這個值。 */
  sessionId: string;
  isMember: boolean;
  isAdmin: boolean;
}

export interface AuthEnv {
  LUNCH_ADMIN_IDS?: string;
  LUNCH_MEMBER_IDS?: string;
}

const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";

function configuredIds(value: string | undefined) {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

function decodeHeader(value: string | null) {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

/** 不採用 Cookie：同一 ChatGPT identity 在不同裝置會得到同一個領域 session。 */
export async function sessionIdForUser(userId: string) {
  const input = new TextEncoder().encode(`my-lunch-town:site-identity:${userId}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function resolveActor(headers: Pick<Headers, "get">, env: AuthEnv): Promise<AuthActor | undefined> {
  const userId = headers.get("oai-authenticated-user-id")?.trim();
  if (!userId) return undefined;
  const admins = configuredIds(env.LUNCH_ADMIN_IDS);
  const members = configuredIds(env.LUNCH_MEMBER_IDS);
  const isAdmin = admins.has(userId);
  return {
    userId,
    email: headers.get("oai-authenticated-user-email")?.trim() ?? "",
    name: decodeHeader(headers.get("oai-authenticated-user-name") ?? headers.get("oai-authenticated-user-full-name")).trim(),
    sessionId: await sessionIdForUser(userId),
    isMember: isAdmin || members.has(userId),
    isAdmin,
  };
}

/** 僅保存不可反推的活動紀錄；不在資料庫複製 email 或顯示名稱。 */
export function ensureAuthSchema(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS authenticated_users (
    user_id TEXT PRIMARY KEY,
    last_seen_at INTEGER NOT NULL
  )`);
}

export function recordActor(db: Db, actor: AuthActor) {
  db.prepare(`INSERT INTO authenticated_users (user_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`).run(actor.userId, Date.now());
}

/** Node 開發模式不使用平台標頭；Sites 才必須先有 ChatGPT 身分。 */
export function requireActor(ctx: Ctx): AuthActor | undefined {
  if (!ctx.platformAuth) return undefined;
  if (!ctx.actor) throw new AppError("SESSION_REQUIRED", 401, "請先使用 ChatGPT 登入");
  return ctx.actor;
}

export function requireInternalMember(ctx: Ctx) {
  const actor = requireActor(ctx);
  if (actor && !actor.isMember) throw err.notAllowed("你的 ChatGPT 帳號尚未加入午餐小鎮");
  return actor;
}

export function requireAdmin(ctx: Ctx) {
  const actor = requireInternalMember(ctx);
  if (actor && !actor.isAdmin) throw err.notAllowed("只有平台管理員可以執行這個操作");
  return actor;
}

export function authPaths() {
  return { signInPath: SIGN_IN_PATH, signOutPath: SIGN_OUT_PATH };
}
