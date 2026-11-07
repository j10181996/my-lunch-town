import { MEAL_IMAGE_SIZE, MEAL_PALETTE_RGB, nearestMealColor } from "../../shared/meal-images";

export type MealDish = "bento" | "bowl" | "plate";
const GRID = 24;
const INK = [68, 48, 39], CREAM = [255, 245, 210];
// 食材排除藍灰色餐具色，避免照片背景轉成零碎的冷色斑點。
const FOOD_COLORS = MEAL_PALETTE_RGB.filter((_, i) => ![15, 20, 21].includes(i));

/** 用內建素材的 24 格比例重組餐具與食材，最後輸出相容的 32×32 PNG 像素。 */
export function styleMealPhoto(source: ArrayLike<number>, dish: MealDish): Uint8Array {
  if (source.length !== MEAL_IMAGE_SIZE ** 2 * 4) throw new Error("照片取樣尺寸錯誤");
  const out = new Uint8Array(GRID * GRID * 4);
  const put = (x: number, y: number, color: number[]) => { out.set([...color, 255], (y * GRID + x) * 4); };
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) put(px, py, color);
  };
  const inOval = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1;
  const oval = (cx: number, cy: number, rx: number, ry: number, color: number[]) => {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (inOval(x, y, cx, cy, rx, ry)) put(x, y, color);
  };
  if (dish === "bento") {
    rect(1, 5, 22, 16, INK); rect(2, 6, 20, 13, [184, 107, 50]);
    rect(3, 7, 18, 10, [240, 191, 110]); rect(3, 19, 18, 1, [224, 156, 71]);
  } else if (dish === "bowl") {
    for (let y = 10; y < 22; y++) {
      const inset = Math.floor((y - 10) / 2);
      rect(1 + inset, y, 22 - inset * 2, 1, INK);
      if (y < 20) rect(3 + inset, y, 18 - inset * 2, 1, [181, 107, 71]);
    }
    rect(6, 16, 3, 2, [255, 186, 120]);
    oval(12, 10, 11, 6, INK); oval(12, 9.5, 10, 5, CREAM);
  } else {
    oval(12, 16, 11, 6, INK); oval(12, 15.5, 10, 5, [170, 187, 176]);
    oval(12, 15, 9, 4, CREAM); oval(12, 12, 9, 6, INK);
  }
  const region = dish === "bento" ? { x: 4, y: 8, w: 16, h: 8 } : dish === "bowl" ? { x: 4, y: 6, w: 16, h: 7 } : { x: 4, y: 7, w: 16, h: 10 };
  for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) {
    if (dish !== "bento" && !inOval(x, y, region.x + region.w / 2, region.y + region.h / 2, region.w / 2, region.h / 2)) continue;
    const sx = Math.min(31, Math.floor((x - region.x + .5) / region.w * 32));
    const sy = Math.min(31, Math.floor((y - region.y + .5) / region.h * 32));
    // 3×3 中位數去除孤立亮點，保留食材的大色塊，不加抖色顆粒。
    const channels: number[][] = [[], [], []];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = (Math.max(0, Math.min(31, sy + dy)) * 32 + Math.max(0, Math.min(31, sx + dx))) * 4;
      if (source[p + 3] < 128) continue;
      for (let c = 0; c < 3; c++) channels[c].push(source[p + c]);
    }
    const rgb = channels.map((values) => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : 255);
    const neutral = Math.max(...rgb) - Math.min(...rgb) < 28;
    put(x, y, neutral && Math.min(...rgb) > 100 ? CREAM : nearestMealColor(rgb[0], rgb[1], rgb[2], FOOD_COLORS));
  }
  const result = new Uint8Array(MEAL_IMAGE_SIZE ** 2 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const p = (Math.floor((y + .5) * GRID / 32) * GRID + Math.floor((x + .5) * GRID / 32)) * 4;
    result.set(out.subarray(p, p + 4), (y * 32 + x) * 4);
  }
  return result;
}
