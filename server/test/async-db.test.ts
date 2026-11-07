import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { asyncDb } from "../db";
import { withWriteTx } from "../db-shared";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fresh() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  return { raw, db: asyncDb(raw) };
}
const count = async (db: ReturnType<typeof asyncDb>) => (await db.prepare("SELECT COUNT(*) AS n FROM t").first<{ n: number }>())!.n;

/** Node 的非同步 Db（server/db.ts 的 asyncDb）：同一條連線上的交易隔離與 D1 形狀的介面。 */
describe("Node 非同步 Db", () => {
  it("D1 形狀：first 沒有資料回 null，all 回 results，run 回 meta.changes", async () => {
    const { db } = fresh();
    expect(await db.prepare("SELECT * FROM t WHERE id = ?").bind(1).first()).toBeNull();
    expect((await db.prepare("INSERT INTO t (id, v) VALUES (?, ?), (?, ?)").bind(1, "a", 2, "b").run()).meta.changes).toBe(2);
    expect((await db.prepare("SELECT v FROM t ORDER BY id").all<{ v: string }>()).results).toEqual([{ v: "a" }, { v: "b" }]);
    // bind 回傳新的語句，可重複使用同一個 prepare。
    const one = db.prepare("SELECT v FROM t WHERE id = ?");
    expect(await one.bind(2).first()).toEqual({ v: "b" });
    expect(await one.bind(1).first()).toEqual({ v: "a" });
  });

  it("交易外的讀取等交易結束，不會讀到尚未提交的資料", async () => {
    const { db } = fresh();
    const seen: string[] = [];
    let inserted!: () => void;
    const written = new Promise<void>((resolve) => (inserted = resolve));
    // 另一個請求：在交易外等到交易寫入後才讀取（從交易裡發起的查詢會被視為交易的一部分）。
    const outside = written.then(() => count(db)).then((n) => seen.push(`outside ${n}`));
    const tx = withWriteTx(db, async () => {
      await db.prepare("INSERT INTO t (id, v) VALUES (1, 'x')").run();
      inserted(); // 已寫入、尚未提交，讓出執行權給外部讀取
      await tick();
      seen.push(`inside ${await count(db)}`); // 交易內看得到自己的寫入
      throw new Error("rollback");
    });
    await expect(tx).rejects.toThrow("rollback");
    await outside;
    // 外部讀取等到交易回滾後才執行，讀到 0 而不是未提交的 1。
    expect(seen).toEqual(["inside 1", "outside 0"]);
  });

  it("並發交易依序執行，不會在交易內再開交易", async () => {
    const { db } = fresh();
    const order: string[] = [];
    const write = (id: number) => withWriteTx(db, async () => {
      order.push(`start ${id}`);
      const n = await count(db);
      await tick();
      await db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(id, String(n)).run();
      order.push(`end ${id}`);
    });
    await Promise.all([write(1), write(2), write(3)]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2", "start 3", "end 3"]);
    // 每筆交易讀到的筆數都包含前一筆的寫入。
    expect((await db.prepare("SELECT v FROM t ORDER BY id").all<{ v: string }>()).results.map((r) => r.v)).toEqual(["0", "1", "2"]);
  });

  it("交易失敗回滾後，下一筆交易照常執行", async () => {
    const { db } = fresh();
    await expect(withWriteTx(db, async () => {
      await db.prepare("INSERT INTO t (id, v) VALUES (1, 'x')").run();
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await withWriteTx(db, async () => { await db.prepare("INSERT INTO t (id, v) VALUES (2, 'y')").run(); });
    expect((await db.prepare("SELECT id FROM t").all<{ id: number }>()).results).toEqual([{ id: 2 }]);
  });

  it("batch 全部成功或全部回滾，並回傳每句結果", async () => {
    const { db } = fresh();
    const ok = await db.batch([
      db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(1, "a"),
      db.prepare("SELECT v FROM t WHERE id = ?").bind(1),
    ]);
    expect(ok[0].meta.changes).toBe(1);
    expect(ok[1].results).toEqual([{ v: "a" }]);
    await expect(db.batch([
      db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(2, "b"),
      db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(1, "dup"),
    ])).rejects.toThrow();
    expect(await count(db)).toBe(1);
  });

  it("巢狀交易直接報錯，不會卡住", async () => {
    const { db } = fresh();
    await expect(withWriteTx(db, () => withWriteTx(db, async () => 1))).rejects.toThrow("不支援巢狀交易");
    await withWriteTx(db, async () => { await db.prepare("INSERT INTO t (id, v) VALUES (1, 'ok')").run(); });
    expect(await count(db)).toBe(1);
  });

  it("同一條連線只建立一個排程", () => {
    const raw = new DatabaseSync(":memory:");
    expect(asyncDb(raw)).toBe(asyncDb(raw));
  });
});
