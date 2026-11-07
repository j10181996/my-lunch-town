import { ctxOf, makeCanvas, rect, px, sprite, tint, hash, type Ctx2D } from "./pixel";

export const TILE = 16;
export type TileKind = "grass" | "stone" | "planks" | "floor" | "wall" | "roof";
const cache = new Map<string, HTMLCanvasElement>();

/** Original material atlas. Grass has four deterministic variants; buildings share timber materials. */
export function tile(kind: TileKind, base = "#70a83b", shade = tint(base, -26), variant = 0) {
  const key = `${kind}:${base}:${shade}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(TILE, TILE);
  const c = ctxOf(canvas);
  rect(c, 0, 0, 16, 16, base);
  const light = tint(base, 23);
  if (kind === "grass") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = hash(x, y, 17 + variant);
        if (n < 0.19) px(c, x, y, shade);
        else if (n > 0.77) rect(c, x, y, n > 0.94 ? 2 : 1, 1, light);
      }
    }
    sprite(c, ["..l..", "s.l.s", ".sls.", "..s.."], { s: shade, l: light }, 2 + variant, 3);
    sprite(c, ["l..l", ".sl.", "..s."], { s: shade, l: light }, 10 - variant, 11);
  } else if (kind === "stone") {
    for (let y = 0; y < 16; y += 8) {
      rect(c, 0, y, 16, 1, shade);
      rect(c, y ? 7 : 0, y, 1, 8, shade);
      rect(c, 1, y + 1, 14, 1, light);
      rect(c, 3, y + 5, 4, 1, tint(base, -10));
    }
  } else if (kind === "roof") {
    // Long, split wooden shakes overlap; uneven ends avoid a regular brick pattern.
    for (let y = 0; y < 16; y += 4) {
      rect(c, 0, y, 16, 1, light);
      rect(c, 0, y + 3, 16, 1, shade);
      for (let x = y % 8 ? -3 : 1; x < 16; x += 6) {
        rect(c, x, y + 1, 1, 3, tint(base, -33));
        rect(c, x + 2, y + 1, 1, 2, tint(base, 9));
        px(c, x + 4, y + 2, tint(base, -13));
      }
    }
  } else if (kind === "floor") {
    rect(c, 0, 0, 16, 1, light);
    rect(c, 0, 15, 16, 1, shade);
    rect(c, 15, 0, 1, 16, shade);
    rect(c, 2, 2, 12, 1, tint(base, 10));
  } else {
    const spacing = kind === "wall" ? 4 : 8;
    for (let y = 0; y < 16; y += spacing) {
      rect(c, 0, y, 16, 1, shade);
      rect(c, 0, y + 1, 16, 1, light);
      rect(c, y % 16 ? 5 : 12, y, 1, spacing, shade);
      rect(c, 2, y + 3, 7, 1, tint(base, -13));
      rect(c, 7, y + 2, 5, 1, tint(base, 10));
      if (kind === "planks") sprite(c, [".ss.", "slls", ".ss."], {
        s: tint(base, -17), l: base,
      }, y ? 9 : 1, y + 4);
    }
  }
  cache.set(key, canvas);
  return canvas;
}

export function fillTiles(c: Ctx2D, image: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  for (let yy = y; yy < y + h; yy += TILE)
    for (let xx = x; xx < x + w; xx += TILE) c.drawImage(image, xx, yy);
  c.restore();
}

/** Visual paths are independent of walkability. No water or road collision is created here. */
export function townGround(c: Ctx2D, roads: Array<{ x: number; y: number; w: number; h: number }>) {
  for (let y = 0; y < 216; y += 16)
    for (let x = 0; x < 384; x += 16)
      c.drawImage(tile("grass", "#70a83b", "#568a2e", Math.floor(hash(x, y, 4) * 4)), x, y);
  const roadAt = (x: number, y: number) => roads.some((r) => {
    const horizontal = r.w > r.h;
    const bend = horizontal ? Math.sin(x / 31) * 4 + Math.sin(x / 63) * 3 : Math.sin(y / 26) * 3;
    const middle = horizontal ? r.y + r.h / 2 : r.x + r.w / 2;
    return horizontal
      ? x >= r.x && x < r.x + r.w && Math.abs(y - middle - bend) < 7
      : y >= r.y && y < r.y + r.h && Math.abs(x - middle - bend) < 5;
  });
  const onPath = (x: number, y: number) => {
    if (roadAt(x, y)) return true;
    // Individual door approaches join the two winding village paths.
    for (const dy of [74, 178])
      for (const dx of [72, 192, 312])
        if (y >= dy - 1 && y < dy + 24 && Math.abs(x - dx - Math.sin(y / 5)) < 5) return true;
    return false;
  };
  for (let y = 0; y < 216; y++) {
    for (let x = 0; x < 384; x++) {
      const n = hash(x, y, 29);
      if (!onPath(x, y)) {
        if (onPath(x, y - 1) || onPath(x - 1, y)) px(c, x, y, "#95af4b");
        if (n > 0.998) {
          sprite(c, [".f.", "fLf", ".g."], { f: "#e1d582", L: "#fff1b5", g: "#3e782c" }, x, y);
        }
        continue;
      }
      const edge = !onPath(x, y - 1) || !onPath(x - 1, y) || !onPath(x + 1, y);
      px(c, x, y, edge ? (n > 0.4 ? "#b6ad69" : "#79943e")
        : n < 0.055 ? "#c3ad72" : n > 0.92 ? "#e1cf94" : "#d6c28a");
    }
  }
  // A stream threads the western alley. Banks are irregular, with pale moving-water marks.
  for (let y = 0; y < 216; y++) {
    const left = 130 + Math.round((Math.sin(y / 24) * 4 + Math.sin(y / 9) * 2) / 2) * 2;
    rect(c, left - 2, y, 12, 1, "#416d32");
    rect(c, left - 1, y, 10, 1, "#b2ba71");
    rect(c, left, y, 8, 1, "#438eab");
    rect(c, left + 1, y, 6, 1, "#58b4cf");
    if (y % 7 === 1) rect(c, left + 2 + y % 3, y, 3, 1, "#a7d9da");
    if (y % 13 === 3) rect(c, left + 1, y, 2, 1, "#e1edd4");
  }
  for (const y of [91, 194]) {
    rect(c, 121, y - 7, 26, 16, "#534a2d");
    for (let x = 122; x < 147; x += 4) {
      rect(c, x, y - 7, 3, 15, "#9d7a46");
      rect(c, x, y - 6, 1, 13, "#ccb075");
      rect(c, x + 2, y - 3, 1, 8, "#806039");
    }
    rect(c, 120, y - 8, 28, 2, "#725538");
    rect(c, 120, y + 8, 28, 2, "#725538");
    rect(c, 120, y - 8, 28, 1, "#cfb17b");
  }
}
