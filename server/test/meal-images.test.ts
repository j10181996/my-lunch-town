import { afterEach, expect, it, vi } from "vitest";
import { inject } from "./inject";
import { inflateSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, SAMPLE_SEED } from "../db";
import { noopEvents } from "../context";
import { uploadMealImage, readMealImage, type ImageStorage } from "../images/images";
import { fileImageStorage } from "../images/files";
import { encodeMealPng } from "../images/png";
import { MEAL_PALETTE_RGB, quantizeMealPixels } from "../../shared/meal-images";
import { styleMealPhoto, type MealDish } from "../../web/shop-admin/meal-photo-style";
import { updateMeal } from "../stores/stores";
import { createRoom, buildSnapshot } from "../rooms/rooms";
import { buildApp } from "../app";
import { photoDimensions } from "../../web/shop-admin/meal-photo";

afterEach(() => vi.restoreAllMocks());
const pixels = () => Array.from({ length: 4096 }, (_, i) => i % 4 === 3 ? 255 : i % 256);
function fixture() {
  const db = openDb(":memory:", SAMPLE_SEED);
  db.prepare("UPDATE stores SET owner_session_id = 'shop' WHERE id = 'store-af'").run();
  const objects = new Map<string, Uint8Array>();
  const images: ImageStorage = { async put(key, value) { objects.set(key, value); }, async get(key) { return objects.get(key) ?? null; } };
  return { db, objects, images, ctx: { db, images, events: noopEvents } };
}
it("固定尺寸量化、透明像素清除及格式限制", () => {
  const data = pixels(); data[0] = 255; data[1] = 245; data[2] = 210;
  expect(Array.from(quantizeMealPixels(data).subarray(0, 4))).toEqual([255, 245, 210, 255]);
  data[3] = 127; expect(Array.from(quantizeMealPixels(data).subarray(0, 4))).toEqual([0, 0, 0, 0]);
  for (const invalid of [[], new Array(4097).fill(0), data.map((n, i) => i === 2 ? 256 : n), data.map((n, i) => i === 2 ? 1.5 : n)]) {
    expect(() => quantizeMealPixels(invalid)).toThrow();
  }
});
it("小鎮色盤與描邊不被後端二次量化改色", () => {
  for (const color of MEAL_PALETTE_RGB) {
    const input = new Array(4096).fill(0);
    for (let p = 0; p < input.length; p += 4) input.splice(p, 4, ...color, 255);
    expect(Array.from(quantizeMealPixels(input))).toEqual(input);
  }
});
it("三種餐具都保留透明邊界、內建深棕描邊與食材差異", () => {
  const pictures = new Set<string>();
  for (const dish of ["bento", "bowl", "plate"] as MealDish[]) {
    const photo = pixels();
    const styled = styleMealPhoto(photo, dish);
    expect(styled.length).toBe(4096);
    for (let x = 0; x < 32; x++) { expect(styled[x * 4 + 3]).toBe(0); expect(styled[(31 * 32 + x) * 4 + 3]).toBe(0); }
    expect(Array.from(quantizeMealPixels(styled))).toEqual(Array.from(styled));
    expect(Array.from(styled).join(",")).toContain("68,48,39,255");
    const green = Array.from({ length: 4096 }, (_, p) => [40, 101, 58, 255][p % 4]);
    expect(styleMealPhoto(green, dish)).not.toEqual(styled);
    pictures.add(Array.from(styled).join(","));
  }
  expect(pictures.size).toBe(3);
});
it("去除孤立雜點，灰白背景整理成米白色而不增加雜色", () => {
  const gray: number[] = Array.from({ length: 4096 }, (_, p) => p % 4 === 3 ? 255 : 170);
  const clean = styleMealPhoto(gray, "bento");
  const noisy = [...gray]; noisy.splice((15 * 32 + 15) * 4, 4, 255, 0, 255, 255);
  expect(styleMealPhoto(noisy, "bento")).toEqual(clean);
  expect(Array.from(clean).join(",")).toContain("255,245,210,255");
});
it("PNG 檔頭、尺寸、CRC 與解壓後像素皆正確", () => {
  const rgba = quantizeMealPixels(pixels()); const png = encodeMealPng(rgba);
  expect(photoDimensions(png, "image/png")).toEqual({ width: 32, height: 32 });
  const view = new DataView(png.buffer); let offset = 8; const compressed: Uint8Array[] = [];
  while (offset < png.length) {
    const size = view.getUint32(offset);
    const name = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (const b of png.subarray(offset + 4, offset + 8 + size)) {
      crc ^= b; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    expect(view.getUint32(offset + 8 + size)).toBe((crc ^ 0xffffffff) >>> 0);
    if (name === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const decoded = inflateSync(Buffer.concat(compressed));
  for (let row = 0; row < 32; row++) {
    expect(decoded[row * 129]).toBe(0);
    expect(Array.from(decoded.subarray(row * 129 + 1, row * 129 + 129))).toEqual(Array.from(rgba.subarray(row * 128, row * 128 + 128)));
  }
});
it("照片檔頭拒絕偽造格式、超大圖片，並支援 JPEG", () => {
  const png = encodeMealPng(quantizeMealPixels(pixels()));
  const huge = new Uint8Array(png); new DataView(huge.buffer).setUint32(16, 10000);
  expect(() => photoDimensions(huge, "image/png")).toThrow(/尺寸過大/);
  expect(() => photoDimensions(png, "image/jpeg")).toThrow(/格式/);
  expect(() => photoDimensions(new TextEncoder().encode("<svg></svg>"), "image/png")).toThrow(/格式/);
  expect(photoDimensions(new Uint8Array([255, 216, 255, 192, 0, 7, 8, 0, 32, 0, 64]), "image/jpeg")).toEqual({ width: 64, height: 32 });
});
it("只有店家可上傳、同圖重試去重，跨店不可沿用圖片", async () => {
  const { db, ctx, objects } = fixture();
  try {
    await expect(uploadMealImage(ctx, "stranger", "store-af", { pixels: pixels() })).rejects.toMatchObject({ status: 403 });
    expect(objects.size).toBe(0);
    const uploaded = await uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() });
    expect(await uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() })).toEqual(uploaded);
    expect(db.prepare("SELECT COUNT(*) AS n FROM meal_images").get()).toMatchObject({ n: 1 });
    expect(objects.size).toBe(1);
    expect(await readMealImage(ctx, uploaded.imageAssetKey)).toBeInstanceOf(Uint8Array);
    db.prepare("UPDATE stores SET owner_session_id = 'shop' WHERE id = 'store-tree'").run();
    expect(() => updateMeal(db, "shop", "store-tree", "meal-tree-dry", { imageAssetKey: uploaded.imageAssetKey })).toThrow(/這家店/);
    expect(() => updateMeal(db, "shop", "store-af", "meal-af-chicken", { imageAssetKey: "custom-" + "f".repeat(64) })).toThrow(/這家店/);
  } finally { db.close(); }
});
it("換圖不改既有團、舊圖片仍可讀取，新團取得新圖", async () => {
  const { db, ctx } = fixture();
  try {
    const first = await uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() });
    updateMeal(db, "shop", "store-af", "meal-af-chicken", { imageAssetKey: first.imageAssetKey });
    const old = createRoom(ctx, "owner", { title: "舊團", nickname: "團主", storeIds: ["store-af"], requestId: "old-room-image" });
    const changed = pixels(); changed[0] = 255;
    const second = await uploadMealImage(ctx, "shop", "store-af", { pixels: changed });
    expect(first.imageAssetKey).not.toBe(second.imageAssetKey);
    updateMeal(db, "shop", "store-af", "meal-af-chicken", { imageAssetKey: second.imageAssetKey });
    const current = createRoom(ctx, "owner", { title: "新團", nickname: "團主", storeIds: ["store-af"], requestId: "new-room-image" });
    expect(buildSnapshot(db, old.snapshot.room.id, "owner").catalog.meals.find((m) => m.id === "meal-af-chicken")?.imageAssetKey).toBe(first.imageAssetKey);
    expect(current.snapshot.catalog.meals.find((m) => m.id === "meal-af-chicken")?.imageAssetKey).toBe(second.imageAssetKey);
    expect((await readMealImage(ctx, first.imageAssetKey)).length).toBeGreaterThan(0);
  } finally { db.close(); }
});
it("儲存失敗不登記圖片；等待儲存期間撤銷權限也不可登記", async () => {
  const { db, ctx } = fixture();
  try {
    ctx.images.put = async () => { throw new Error("儲存失敗"); };
    await expect(uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() })).rejects.toThrow("儲存失敗");
    expect(db.prepare("SELECT COUNT(*) AS n FROM meal_images").get()).toMatchObject({ n: 0 });
    ctx.images.put = async () => { db.prepare("UPDATE stores SET owner_session_id = 'new-owner' WHERE id = 'store-af'").run(); };
    await expect(uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() })).rejects.toMatchObject({ status: 403 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM meal_images").get()).toMatchObject({ n: 0 });
  } finally { db.close(); }
});
it("Node 檔案儲存可跨實例讀取，拒絕路徑跳脫", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meal-image-test-"));
  try {
    const key = `meal-images/store-test/custom-${"a".repeat(64)}.png`;
    await fileImageStorage(directory).put(key, new Uint8Array([1, 2, 3]));
    await fileImageStorage(directory).put(key, new Uint8Array([4, 5, 6]));
    expect(await fileImageStorage(directory).get(key)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(fileImageStorage(directory).put("../escape", new Uint8Array())).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("店家上限仍允許同圖重試，非同步儲存後會重新檢查額度", async () => {
  const { db, ctx, objects } = fixture();
  try {
    const first = await uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() });
    const fill = (count: number) => {
      for (let i = 0; i < count; i++) db.prepare("INSERT INTO meal_images VALUES (?, 'store-af', ?, ?)")
        .run(`custom-${i.toString(16).padStart(64, "0")}`, `unused-${i}`, Date.now());
    };
    fill(99);
    expect(await uploadMealImage(ctx, "shop", "store-af", { pixels: pixels() })).toEqual(first);
    const next = pixels(); next[0] = 255;
    await expect(uploadMealImage(ctx, "shop", "store-af", { pixels: next })).rejects.toMatchObject({ status: 400 });
    expect(objects.size).toBe(1);
    db.prepare("DELETE FROM meal_images WHERE object_key = 'unused-98'").run();
    ctx.images.put = async () => { db.prepare("INSERT INTO meal_images VALUES ('concurrent', 'store-af', 'concurrent', 0)").run(); };
    await expect(uploadMealImage(ctx, "shop", "store-af", { pixels: next })).rejects.toMatchObject({ status: 400 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM meal_images").get()).toMatchObject({ n: 100 });
  } finally { db.close(); }
});
it("共用 API 能上傳與讀取二進位 PNG；無權上傳被拒", async () => {
  const { db, ctx } = fixture(); const app = await buildApp({ ctx });
  try {
    const claimed = await inject(app, { method: "POST", url: "/api/stores/claim", payload: { manageKey: "demo-store-af" } });
    const cookie = String(claimed.headers["set-cookie"]).split(";")[0];
    const response = await inject(app, { method: "POST", url: "/api/stores/store-af/images", headers: { cookie }, payload: { pixels: pixels() } });
    expect(response.statusCode).toBe(200);
    const image = await inject(app, { method: "GET", url: `/api/meal-images/${response.json().imageAssetKey}` });
    expect(image.statusCode).toBe(200); expect(image.headers["content-type"]).toContain("image/png");
    expect(Array.from(image.rawPayload.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await inject(app, { method: "POST", url: "/api/stores/store-af/images", payload: { pixels: pixels() } })).statusCode).toBe(403);
    expect((await inject(app, { method: "POST", url: "/api/stores/store-af/images", headers: { cookie }, payload: { pixels: [] } })).statusCode).toBe(400);
    expect((await inject(app, { method: "GET", url: `/api/meal-images/custom-${"0".repeat(64)}` })).statusCode).toBe(404);
  } finally { db.close(); }
});
