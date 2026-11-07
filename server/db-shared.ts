import { createHash } from "node:crypto";
import type { ErrorCode } from "../shared/contracts";

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

/** SQLite 欄位值。 */
export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

/**
 * 領域模組使用的非同步資料庫介面，形狀與 Cloudflare D1 相同：
 * prepare(sql).bind(...).first()／all()／run()，以及 batch()。
 * Node（server/db.ts）與 Worker 各自提供實作；領域模組只依賴這個介面。
 */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Db {
  prepare(sql: string): Statement;
  /** 依序執行，全部成功或全部回滾。 */
  batch(statements: Statement[]): Promise<Array<{ results: Row[]; meta: { changes: number } }>>;
  /**
   * 互動式交易：fn 內的查詢看得到彼此的寫入，交易外的查詢要等它結束。
   * D1 沒有這個能力，#101 第 3b 階段會改用 batch 取代；新程式請用 withWriteTx，不要直接呼叫。
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** 同步介面：只給遷移與種子匯入使用（Node 啟動、Worker 開啟 image 時執行）。 */
export interface SyncDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): { changes: number | bigint };
  };
}

/** 同步交易，供遷移與種子匯入使用。 */
export function withSyncTx<T>(db: SyncDb, fn: () => T): T {
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

/** 會改變資料的領域操作一律包在這裡：fn 內的查詢全部成功才提交。 */
export function withWriteTx<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/**
 * 交易排程：Node 的單一連線上，交易進行中時，交易外的查詢要等它結束，
 * 才不會讀到尚未提交的資料。inTx 回報目前的呼叫是否在進行中的交易內。
 */
export interface TxScheduler {
  /** 交易外的查詢在執行前等待（沒有交易進行中則立即繼續）。 */
  idle(): Promise<void> | void;
  /** 以獨佔方式執行交易本體。 */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/** 單一請求獨佔資料庫時（Worker 每個請求各自開一份 image）使用：不需要排程。 */
export const noScheduler: TxScheduler = { idle() {}, exclusive: (fn) => fn() };

const READS_ROWS = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b|\bRETURNING\b/i;
type SyncStatement = Statement & { execute(): { results: Row[]; meta: { changes: number } } };

/** 把同步的 SQLite 介面包成非同步的 Db。 */
export function fromSync(sync: SyncDb, scheduler: TxScheduler = noScheduler): Db {
  /**
   * 確認沒有其他交易後立刻同步執行 SQL，兩者之間不讓出執行權；
   * 否則排隊中的交易可能在 await 的空檔先 BEGIN，交易外的 SQL 就會混進它的交易。
   */
  const whenIdle = async <T>(op: () => T): Promise<T> => {
    for (;;) {
      const wait = scheduler.idle();
      if (!wait) return op();
      await wait;
    }
  };
  const statement = (sql: string, args: unknown[]): SyncStatement => ({
    bind: (...values) => statement(sql, values),
    first<T>() {
      return whenIdle(() => (sync.prepare(sql).get(...args) as T | undefined) ?? null);
    },
    all<T>() {
      return whenIdle(() => ({ results: sync.prepare(sql).all(...args) as T[] }));
    },
    run() {
      return whenIdle(() => ({ meta: { changes: Number(sync.prepare(sql).run(...args).changes) } }));
    },
    /** batch 用：在獨佔區段內同步執行，讀取型語句回傳資料列，其餘回傳異動筆數。 */
    execute() {
      if (READS_ROWS.test(sql)) return { results: sync.prepare(sql).all(...args) as Row[], meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(sync.prepare(sql).run(...args).changes) } };
    },
  });
  const db: Db = {
    prepare: (sql) => statement(sql, []),
    // 任何一句失敗都會讓整個交易回滾。
    batch: (statements) => db.transaction(async () => statements.map((s) => (s as SyncStatement).execute())),
    transaction: (fn) => scheduler.exclusive(async () => {
      try {
        sync.exec("BEGIN IMMEDIATE");
      } catch (e) {
        if (isBusy(e)) throw err.retry();
        throw e;
      }
      try {
        const result = await fn();
        sync.exec("COMMIT");
        return result;
      } catch (e) {
        try {
          sync.exec("ROLLBACK");
        } catch {
          /* 已回滾 */
        }
        if (isBusy(e)) throw err.retry();
        throw e;
      }
    }),
  };
  return db;
}

function isBusy(e: unknown) {
  return e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message);
}
