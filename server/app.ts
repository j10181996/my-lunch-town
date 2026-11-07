import { registerRoutes } from "./routes";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import type { Ctx } from "./context";
import { AppError } from "./db";
import { randomId } from "./util";
export const SESSION_COOKIE = "lt_sid";
const SID_RE = /^[a-z0-9]{24}$/;

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

export interface AppOptions {
  ctx: Ctx;
  staticDir?: string;
  secureCookie?: boolean;
  /** 展示用後台碼：輸入後一次認領所有種子店家；未設定或空字串則停用。 */
  demoKey?: string;
}

export async function buildApp({ ctx, staticDir, secureCookie = false, demoKey }: AppOptions) {
  const app = Fastify({ logger: false });
  const { db } = ctx;
  await app.register(cookie);

  app.decorateRequest("sid", "");
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url.startsWith("/api/meal-images/")) return;
    let sid = req.cookies[SESSION_COOKIE];
    if (!sid || !SID_RE.test(sid)) {
      sid = randomId(24);
      reply.setCookie(SESSION_COOKIE, sid, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookie,
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    db.prepare("INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)").run(sid, Date.now());
    req.sid = sid;
  });

  app.setErrorHandler((error: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ code: error.code, message: error.message });
    }
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(400).send({ code: "INVALID_INPUT", message: "請求格式錯誤" });
    }
    console.error(error);
    return reply.status(500).send({ code: "RETRY_LATER", message: "伺服器發生錯誤" });
  });

  registerRoutes(app, ctx, demoKey);

  // —— 正式環境：同一網址供應前端 ——
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/socket.io")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ code: "INVALID_INPUT", message: "找不到" });
    });
  }

  return app;
}
