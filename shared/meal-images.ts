/** 圖片的尺寸與資源限制由前後端共用；原照片不會傳到伺服器。 */
export const MEAL_IMAGE_SIZE = 32;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 16_000_000;
export const CUSTOM_IMAGE_RE = /^custom-[a-f0-9]{64}$/;
export const customImageUrl = (key: string) => CUSTOM_IMAGE_RE.test(key) ? `/api/meal-images/${key}` : null;

/** 沿用內建餐點的暖色、深棕描邊與餐具色；前後端使用相同色盤。 */
export const MEAL_PALETTE = [
  "#443027", "#6b3f2a", "#8d4327", "#ad6035", "#b86b32", "#c26a28", "#d88036", "#f4a539",
  "#ffd66b", "#f0bf6e", "#e09c47", "#efb736", "#ffe681", "#fff5d2", "#dbc49b", "#aabbb0",
  "#28653a", "#31743c", "#8dbb51", "#b0ca6b", "#668e99", "#bfd2bd", "#b56b47", "#ffba78",
  "#d9483e", "#925b30", "#ebc27c", "#ffe485", "#c8944b", "#ffe7a4", "#f7bb65", "#ffb52e",
] as const;
export const MEAL_PALETTE_RGB = MEAL_PALETTE.map((hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)));
export function nearestMealColor(r: number, g: number, b: number, palette = MEAL_PALETTE_RGB): number[] {
  let best = palette[0], distance = Infinity;
  for (const color of palette) {
    const d = 3 * (r - color[0]) ** 2 + 4 * (g - color[1]) ** 2 + 2 * (b - color[2]) ** 2;
    if (d < distance) { distance = d; best = color; }
  }
  return best;
}

/** 透明像素不保留隱藏的原色；伺服器重新驗證且不改變已處理色盤。 */
export function quantizeMealPixels(input: ArrayLike<number>): Uint8Array {
  if (input.length !== MEAL_IMAGE_SIZE * MEAL_IMAGE_SIZE * 4) throw new Error("圖片必須是 32×32 RGBA 像素");
  const result = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 4) {
    for (let j = 0; j < 4; j++) if (!Number.isInteger(input[i + j]) || input[i + j] < 0 || input[i + j] > 255) throw new Error("圖片像素格式錯誤");
    const opaque = input[i + 3] >= 128;
    const color = opaque ? nearestMealColor(input[i], input[i + 1], input[i + 2]) : [0, 0, 0];
    for (let j = 0; j < 3; j++) result[i + j] = color[j];
    result[i + 3] = opaque ? 255 : 0;
  }
  return result;
}
