import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { ImageStorage } from "./images";
/** 僅供 Node；Worker 注入 R2，領域模組不接觸檔案系統。 */
export function fileImageStorage(directory: string): ImageStorage {
  const path = (key: string) => {
    if (!/^meal-images\/store-[a-z0-9-]+\/custom-[a-f0-9]{64}\.png$/.test(key)) throw new Error("圖片儲存路徑無效");
    return join(directory, key);
  };
  return {
    async put(key, bytes) {
      const filename = path(key); await mkdir(dirname(filename), { recursive: true });
      // 完整寫好才原子登記，失敗不留下半張圖；重試不截斷既有團正在讀取的圖片。
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { flag: "wx" });
        try { await link(temporary, filename); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      } finally { await rm(temporary, { force: true }); }
    },
    async get(key) { try { return new Uint8Array(await readFile(path(key))); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } },
  };
}
