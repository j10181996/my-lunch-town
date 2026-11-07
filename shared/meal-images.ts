/** 圖片的尺寸與資源限制由前後端共用；原照片不會傳到伺服器。 */
export const MEAL_IMAGE_SIZE = 32;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 16_000_000;
export const CUSTOM_IMAGE_RE = /^custom-[a-f0-9]{64}$/;
export const customImageUrl = (key: string) => CUSTOM_IMAGE_RE.test(key) ? `/api/meal-images/${key}` : null;

/** 4×4×4 色盤，透明像素不保留隱藏的原色；伺服器也會重新套用。 */
export function quantizeMealPixels(input: ArrayLike<number>): Uint8Array {
  if (input.length !== MEAL_IMAGE_SIZE * MEAL_IMAGE_SIZE * 4) throw new Error("圖片必須是 32×32 RGBA 像素");
  const result = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 4) {
    for (let j = 0; j < 4; j++) if (!Number.isInteger(input[i + j]) || input[i + j] < 0 || input[i + j] > 255) throw new Error("圖片像素格式錯誤");
    const opaque = input[i + 3] >= 128;
    for (let j = 0; j < 3; j++) result[i + j] = opaque ? Math.round(input[i + j] / 85) * 85 : 0;
    result[i + 3] = opaque ? 255 : 0;
  }
  return result;
}
