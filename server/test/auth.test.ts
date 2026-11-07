import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { resolveActor, sessionIdForUser, type AuthActor } from "../auth";
import { openDb, SAMPLE_SEED, type Db } from "../db";
import { noopEvents, type Ctx } from "../context";

let db: Db;

beforeEach(() => { db = openDb(":memory:", SAMPLE_SEED); });

async function actor(userId: string, config: { LUNCH_ADMIN_IDS?: string; LUNCH_MEMBER_IDS?: string } = {}): Promise<AuthActor> {
  const result = await resolveActor({ get: (name) => name === "oai-authenticated-user-id" ? userId : null }, config);
  if (!result) throw new Error("expected an actor");
  return result;
}

async function site(actorValue?: AuthActor): Promise<FastifyInstance> {
  const ctx: Ctx = { db, events: noopEvents, platformAuth: true, actor: actorValue };
  return buildApp({ ctx });
}

async function call(app: FastifyInstance, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, headers?: Record<string, string>) {
  const response = await app.inject({ method, url, payload: body as never, headers });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

describe("ChatGPT Sites 身分與內部授權", () => {
  it("不同裝置的同一個平台 ID 會推導相同 session；不同 ID 絕不相同", async () => {
    expect(await sessionIdForUser("user-alice")).toBe(await sessionIdForUser("user-alice"));
    expect(await sessionIdForUser("user-alice")).not.toBe(await sessionIdForUser("user-bob"));
  });

  it("未登入和未被允許的帳號不能操作內部團購；request header 不能升權", async () => {
    const anonymous = await site();
    expect((await call(anonymous, "POST", "/api/rooms", { title: "午餐", nickname: "A", requestId: "request-0001" })).status).toBe(401);

    const outsider = await actor("user-outsider");
    const outsiderApp = await site(outsider);
    const denied = await call(
      outsiderApp,
      "POST",
      "/api/rooms",
      { title: "午餐", nickname: "A", requestId: "request-0002", role: "admin" },
      { "x-role": "admin", "oai-authenticated-user-id": "someone-else" },
    );
    expect(denied.status).toBe(403);

    // 將使用者自 allowlist 移除後，下一次 resolve 就立即失去內部權限。
    const member = await actor("user-outsider", { LUNCH_MEMBER_IDS: "user-outsider" });
    expect(member.isMember).toBe(true);
    const revoked = await actor("user-outsider");
    expect(revoked.isMember).toBe(false);
  });

  it("店家邀請只能由目標 ChatGPT ID 兌換；店家管理權不等於內部成員", async () => {
    const admin = await actor("user-admin", { LUNCH_ADMIN_IDS: "user-admin" });
    const adminApp = await site(admin);
    const createdStore = await call(adminApp, "POST", "/api/stores", {
      name: "測試咖哩", styleKey: "curry", lotIndex: 3, requestId: "request-store-001",
    });
    expect(createdStore.status).toBe(200);
    const storeId = ((createdStore.body.profile as { id: string }).id);

    const createdInvite = await call(adminApp, "POST", "/api/store-invites", {
      storeId, targetUserId: "user-store", expiresInDays: 7,
    });
    expect(createdInvite.status).toBe(200);
    const token = createdInvite.body.token as string;
    expect(token).toMatch(/^lti_[a-z0-9]+$/);

    const wrongApp = await site(await actor("user-wrong"));
    expect((await call(wrongApp, "POST", "/api/store-invites/accept", { token })).status).toBe(403);

    const storeActor = await actor("user-store");
    const storeApp = await site(storeActor);
    expect((await call(storeApp, "POST", "/api/store-invites/accept", { token })).status).toBe(200);
    expect((await call(storeApp, "GET", `/api/stores/${storeId}`)).status).toBe(200);
    expect((await call(storeApp, "GET", "/api/town")).status).toBe(403);

    // 帶著任何舊 Cookie 也不能把管理權交給另一個平台 identity。
    const cookieThief = await site(await actor("user-cookie-thief"));
    expect((await call(cookieThief, "GET", `/api/stores/${storeId}`, undefined, { cookie: `lt_sid=${storeActor.sessionId}` })).status).toBe(403);

    expect((await call(adminApp, "DELETE", `/api/stores/${storeId}/managers/user-store`)).status).toBe(200);
    expect((await call(storeApp, "GET", `/api/stores/${storeId}`)).status).toBe(403);
  });
});
