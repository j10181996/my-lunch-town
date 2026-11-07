import { createHash } from "node:crypto";
import type { ErrorCode } from "../shared/contracts";
import type { Db } from "./db";

export function hashKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const err = {
  invalid: (m: string) => new AppError("INVALID_INPUT", 400, m),
  session: () => new AppError("SESSION_REQUIRED", 401, "請先加入這個團"),
  notAllowed: (m = "沒有權限") => new AppError("NOT_ALLOWED", 403, m),
  roomNotFound: () => new AppError("ROOM_NOT_FOUND", 404, "找不到這個團"),
  mealNotFound: () => new AppError("MEAL_NOT_FOUND", 404, "找不到這個餐點"),
  closed: () => new AppError("ROOM_CLOSED", 409, "已收單，不能再修改"),
  conflict: () => new AppError("REQUEST_ID_CONFLICT", 409, "同一個請求 ID 對應了不同內容"),
  retry: () => new AppError("RETRY_LATER", 503, "系統忙碌，請稍後重試"),
};

export function withWriteTx<T>(db: Db, fn: () => T): T {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (e) {
    if (isBusy(e)) throw err.retry();
    throw e;
  }
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 已回滾 */
    }
    if (isBusy(e)) throw err.retry();
    throw e;
  }
}

function isBusy(e: unknown) {
  return e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message);
}

