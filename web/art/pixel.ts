/** 1 邏輯像素為單位的繪圖小工具。所有素材先畫在小 canvas，顯示時整數倍放大。 */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function px(ctx: Ctx2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** 填滿橢圓（像素判定，邊緣不抗鋸齒）。 */
export function ellipse(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  clip?: (x: number, y: number) => boolean,
) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!clip || clip(x, y))) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** 帶描邊的橢圓。 */
export function blob(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  outline: string,
) {
  ellipse(ctx, cx, cy, rx + 1, ry + 1, outline);
  ellipse(ctx, cx, cy, rx, ry, fill);
}

/** 帶描邊、圓角的矩形。 */
export function box(ctx: Ctx2D, x: number, y: number, w: number, h: number, fill: string, outline: string) {
  rect(ctx, x + 1, y, w - 2, h, outline);
  rect(ctx, x, y + 1, w, h - 2, outline);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, fill);
}

/** 用固定雜湊撒點，讓材質穩定不閃爍。 */
export function speckle(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  density: number,
  seed = 1,
) {
  ctx.fillStyle = color;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (hash(x + i, y + j, seed) < density) ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

export function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const OUTLINE = "#3b2a20";

/** Hand-placed pixel masks; dots and spaces are transparent. */
export function sprite(ctx: Ctx2D, rows: readonly string[], palette: Record<string, string>, x = 0, y = 0) {
  rows.forEach((row, j) =>
    [...row].forEach((key, i) => {
      if (palette[key]) px(ctx, x + i, y + j, palette[key]);
    }),
  );
}

/** Integer scan conversion keeps sloping edges on the pixel grid. */
export function poly(ctx: Ctx2D, points: number[][], color: string) {
  const minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  for (let y = minY; y < maxY; y++) {
    const cuts: number[] = [];
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
        cuts.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    });
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 2)
      rect(ctx, Math.ceil(cuts[i]), y, Math.ceil(cuts[i + 1]) - Math.ceil(cuts[i]), 1, color);
  }
}

export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  return (
    "#" +
    [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) =>
        Math.max(0, Math.min(255, v + amount))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
