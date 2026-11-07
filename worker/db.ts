import { PARTY_SCHEMA } from "../server/rooms/party-schema";
import { migrateStoreHours } from "../server/store-hours-schema";
import { migrateDeadline } from "../server/rooms/deadline";
import { SOCIAL_SCHEMA } from "../server/rooms/social-schema";
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
  raw.exec(SOCIAL_SCHEMA);
  raw.exec(PARTY_SCHEMA);
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
  migrateStoreHours(db);
  migrateDeadline(db);
  return { db, raw };
}

export function exportSnapshot(raw: Database): Uint8Array {
  return raw.export();
}
