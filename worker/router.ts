import type { FastifyInstance } from "fastify";
import type { Ctx } from "../server/context";
import { registerRoutes } from "../server/routes";
import { err } from "./db";

export interface ApiRequest { sid: string; body: unknown; params: Record<string, string> }
type Handler = (request: ApiRequest, reply: { type(value: string): { send(value: string): string } }) => unknown;

export function dispatch(ctx: Ctx, sid: string, method: string, path: string, body: unknown, demoKey?: string) {
  const routes: Array<{ method: string; path: string; handler: Handler }> = [];
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map((verb) => [
    verb, (path: string, handler: Handler) => routes.push({ method: verb.toUpperCase(), path, handler }),
  ]));
  registerRoutes(app as unknown as FastifyInstance, ctx, demoKey);
  for (const route of routes) {
    if (route.method !== method) continue;
    const keys: string[] = [];
    const pattern = route.path.replace(/:([a-zA-Z]+)/g, (_, key: string) => { keys.push(key); return "([^/]+)"; });
    const match = path.match(new RegExp(`^${pattern}/?$`));
    if (!match) continue;
    const params = Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
    let contentType = "application/json; charset=utf-8";
    const reply = { type(value: string) { contentType = value; return { send(value: string) { return value; } }; } };
    return Promise.resolve(route.handler({ sid, body, params }, reply)).then((result) => ({ result, contentType }));
  }
  throw err.invalid("找不到這個 API");
}
