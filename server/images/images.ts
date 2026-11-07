import { createHash } from "node:crypto";
import type { Ctx } from "../context";
import { AppError, err, withWriteTx, type Db } from "../db";
import { requireOwner } from "../stores/stores";
import { CUSTOM_IMAGE_RE, quantizeMealPixels } from "../../shared/meal-images";
import { DEFAULT_MEAL_ART, MEAL_ART_KEYS } from "../../shared/town";
import { encodeMealPng } from "./png";

export interface ImageStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}
export function resolveMealImage(db: Db, storeId: string, key: string): string {
  if (typeof key !== "string") throw err.invalid("餐點圖片格式錯誤");
  if (MEAL_ART_KEYS.includes(key)) return key;
  if (!key.startsWith("custom-")) return DEFAULT_MEAL_ART;
  if (!CUSTOM_IMAGE_RE.test(key) || !db.prepare("SELECT id FROM meal_images WHERE id = ? AND store_id = ?").get(key, storeId)) throw err.notAllowed("只能使用這家店已上傳的餐點圖片");
  return key;
}
export async function uploadMealImage(ctx: Ctx, sid: string, storeId: string, input: unknown) {
  requireOwner(ctx.db, sid, storeId);
  if (!ctx.images) throw err.retry();
  const pixels = (input as { pixels?: unknown } | null)?.pixels;
  let rgba: Uint8Array;
  try {
    if (!Array.isArray(pixels)) throw new Error("請提供處理後的餐點像素");
    rgba = quantizeMealPixels(pixels);
  } catch (e) { throw err.invalid((e as Error).message); }
  const imageAssetKey = `custom-${createHash("sha256").update(storeId).update(rgba).digest("hex")}`;
  const objectKey = `meal-images/${storeId}/${imageAssetKey}.png`;
  const previous = ctx.db.prepare("SELECT id FROM meal_images WHERE id = ? AND store_id = ?").get(imageAssetKey, storeId);
  const count = ctx.db.prepare("SELECT COUNT(*) AS n FROM meal_images WHERE store_id = ?").get(storeId) as { n: number };
  if (!previous && count.n >= 100) throw err.invalid("這家店已達 100 張自訂圖片上限，請使用內建圖片");
  // 內容定址：重試寫入相同位元組，不覆蓋其他照片；舊團使用的圖片不刪除。
  await ctx.images.put(objectKey, encodeMealPng(rgba));
  withWriteTx(ctx.db, () => {
    requireOwner(ctx.db, sid, storeId);
    const already = ctx.db.prepare("SELECT id FROM meal_images WHERE id = ?").get(imageAssetKey);
    const latest = ctx.db.prepare("SELECT COUNT(*) AS n FROM meal_images WHERE store_id = ?").get(storeId) as { n: number };
    if (!already && latest.n >= 100) throw err.invalid("這家店已達 100 張自訂圖片上限");
    ctx.db.prepare("INSERT OR IGNORE INTO meal_images (id, store_id, object_key, created_at) VALUES (?, ?, ?, ?)")
      .run(imageAssetKey, storeId, objectKey, Date.now());
  });
  return { imageAssetKey };
}
export async function readMealImage(ctx: Ctx, id: string): Promise<Uint8Array> {
  if (!CUSTOM_IMAGE_RE.test(id)) throw new AppError("INVALID_INPUT", 404, "找不到餐點圖片");
  const row = ctx.db.prepare("SELECT object_key FROM meal_images WHERE id = ?").get(id) as { object_key: string } | undefined;
  if (!row) throw new AppError("INVALID_INPUT", 404, "找不到餐點圖片");
  if (!ctx.images) throw err.retry();
  const bytes = await ctx.images.get(row.object_key);
  if (!bytes) throw new AppError("INVALID_INPUT", 404, "找不到餐點圖片");
  return bytes;
}
