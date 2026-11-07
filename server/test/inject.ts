import type { Hono } from "hono";

export interface InjectOptions {
  method?: string;
  url: string;
  /** 物件會轉成 JSON 並補上 content-type；字串原樣送出。 */
  payload?: unknown;
  headers?: Record<string, string>;
}

/** 測試用：以 Hono 的 app.request 送出請求，回傳與舊 Fastify inject 相同形狀的結果。 */
export async function inject(app: Pick<Hono, "request">, { method = "GET", url, payload, headers = {} }: InjectOptions) {
  const init: RequestInit = { method, headers: new Headers(headers) };
  if (payload !== undefined) {
    const h = init.headers as Headers;
    if (typeof payload === "string") init.body = payload;
    else {
      init.body = JSON.stringify(payload);
      if (!h.has("content-type")) h.set("content-type", "application/json");
    }
  }
  const response = await app.request(url, init);
  const rawPayload = Buffer.from(await response.arrayBuffer());
  const body = rawPayload.toString("utf8");
  const cookies = response.headers.getSetCookie();
  return {
    statusCode: response.status,
    headers: { ...Object.fromEntries(response.headers), "set-cookie": cookies.length ? cookies[0] : undefined } as Record<string, string | undefined>,
    body,
    rawPayload,
    json: () => JSON.parse(body),
  };
}
