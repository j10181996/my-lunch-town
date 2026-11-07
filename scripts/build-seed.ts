import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, TAICHUNG_SEED } from "../server/db";
const directory = mkdtempSync(join(tmpdir(), "lunch-town-seed-"));
try {
  const filename = join(directory, "seed.sqlite");
  const db = openDb(filename, TAICHUNG_SEED);
  db.exec(`CREATE TABLE live_bubbles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  writeFileSync("worker/seed.bin", readFileSync(filename));
} finally { rmSync(directory, { recursive: true, force: true }); }
