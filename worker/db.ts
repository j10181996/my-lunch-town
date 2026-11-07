import taichung from "../shared/catalog/stores.taichung.json";
import { migrateTaichungExpansion } from "../server/catalog/taichung-expansion";
import { backfillSeedLocations } from "../server/geo-schema";
import { migrate } from "../server/schema/migrate";
import initSqlJs, { type Database, type SqlValue } from "sql.js/dist/sql-wasm-browser.js";
import sqliteWasm from "./sqlite.wasm";
import seedBytes from "./seed.bin";
import type { Db } from "../server/db";
export { AppError, err, hashKey, withWriteTx } from "../server/db-shared";
export type { Db } from "../server/db";

// Workers receive a precompiled WASM module: no runtime compilation or filesystem.
const sqlite = initSqlJs({
  instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
    const instance = new WebAssembly.Instance(sqliteWasm, imports);
    receive(instance);
    return instance.exports;
  },
});

export async function openSnapshot(bytes?: ArrayBuffer | number[]) {
  const SQL = await sqlite;
  const raw = new SQL.Database(bytes ? new Uint8Array(bytes) : seedBytes);
  raw.exec("PRAGMA foreign_keys = ON");
  // Match node:sqlite's small synchronous surface used by the domain modules.
  // Every statement is freed, including reads returning no rows.
  const query = (sql: string, args: SqlValue[], all: boolean) => {
    const statement = raw.prepare(sql);
    try {
      statement.bind(args);
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
        if (!all) break;
      }
      return all ? rows : rows[0];
    } finally {
      statement.free();
    }
  };
  const db = {
    exec(sql: string) { raw.exec(sql); },
    prepare(sql: string) {
      return {
        get: (...args: SqlValue[]) => query(sql, args, false),
        all: (...args: SqlValue[]) => query(sql, args, true),
        run(...args: SqlValue[]) {
          raw.run(sql, args);
          return { changes: raw.getRowsModified() };
        },
      };
    },
  } as unknown as Db;
  // 與 Node 的 openDb 走同一個遷移入口；舊 image 會先補齊到基線（含外送與收款欄位）。
  // seed.bin 由台中種子建立，舊 image 補外送欄位時也以它回填。
  migrate(db, { legacySeedStores: () => taichung.stores });
  migrateTaichungExpansion(db);
  backfillSeedLocations(db);
  return { db, raw };
}

export function exportSnapshot(raw: Database): Uint8Array {
  return raw.export();
}
