import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { api, errorResponse, readApiRequest, withSessionCookie } from "./api";
import type { Ctx } from "./context";
import { AppError } from "./db";
export { SESSION_COOKIE } from "./api";

export interface AppOptions {
  ctx: Ctx;
  staticDir?: string;
  secureCookie?: boolean;
  /** 展示用後台碼：輸入後一次認領所有種子店家；未設定或空字串則停用。 */
  demoKey?: string;
}

/** Node 執行環境：同一個行程供應 API 與（正式環境的）前端靜態檔。 */
export function buildApp({ ctx, staticDir, secureCookie = false, demoKey }: AppOptions) {
  const app = new Hono();

  app.all("/api/*", async (c) => {
    try {
      const { sid, body, setCookie } = await readApiRequest(c.req.raw, { secureCookie });
      return withSessionCookie(await api.fetch(c.req.raw, { ctx, sid, body, demoKey }), setCookie);
    } catch (error) {
      return errorResponse(error);
    }
  });

  // —— 正式環境：同一網址供應前端；找不到的頁面路徑回 index.html，交給前端路由 ——
  if (staticDir && existsSync(staticDir)) {
    app.use("*", serveStatic({ root: staticDir }));
    app.get("*", serveStatic({ root: staticDir, path: "index.html" }));
  }
  app.notFound(() => errorResponse(new AppError("INVALID_INPUT", 404, "找不到")));

  return app;
}
