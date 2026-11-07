import type { ErrorCode } from "../shared/contracts";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode | "NETWORK",
    message: string,
    public status = 0,
  ) {
    super(message);
  }
  /** 結果未知或伺服器忙碌：應以相同 requestId 重試。 */
  get retryable() {
    return this.code === "NETWORK" || this.code === "RETRY_LATER";
  }
}

const TIMEOUT_MS = 8000;

export async function request<T>(method: string, url: string, body?: unknown, asText = false): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError("NETWORK", "網路連線不穩，結果待確認");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code: ErrorCode = "RETRY_LATER";
    let message = "發生錯誤";
    try {
      const j = (await res.json()) as { code: ErrorCode; message: string };
      code = j.code;
      message = j.message;
    } catch {
      /* 非 JSON */
    }
    throw new ApiError(code, message, res.status);
  }
  return (asText ? await res.text() : await res.json()) as T;
}

/** crypto.randomUUID 只在安全來源可用；區網 http 展示時退回自製版本。 */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "發生未預期的錯誤";
}
