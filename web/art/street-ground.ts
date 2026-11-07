import { STREET_H, STREET_SPAWN, STREET_W } from "../../shared/town";
import { ctxOf, hash, makeCanvas, px, rect, sprite, type Ctx2D } from "./pixel";
import { fillTiles, tile } from "./tiles";
import { streamX, touchesPath, type Path } from "./street-layout";

let dirt: HTMLCanvasElement | undefined;
function dirtTile() {
  if (dirt) return dirt;
  dirt = makeCanvas(16, 16);
  const c = ctxOf(dirt);
  rect(c, 0, 0, 16, 16, "#d6c28a");
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = hash(x, y, 29);
    if (n < 0.055 || n > 0.92) px(c, x, y, n < 0.055 ? "#c3ad72" : "#e1cf94");
  }
  return dirt;
}

/** Tile fills and textured strokes keep work proportional to tiles and road length, not world pixels. */
export function streetGround(c: Ctx2D, paths: Path[]) {
  for (let y = 0; y < STREET_H; y += 16) for (let x = 0; x < STREET_W; x += 16)
    c.drawImage(tile("grass", "#70a83b", "#568a2e", Math.floor(hash(x, y, 4) * 4)), x, y);
  // Terraced earth on the northwest and southeast edges, under the tree wall.
  for (const [x, y, w, h] of [[0, 0, 280, 30], [924, 344, 36, 140], [0, 470, 35, 138]]) {
    rect(c, x, y, w, h, "#725a30");
    for (let yy = y + 3; yy < y + h; yy += 5) for (let xx = x + 2; xx < x + w; xx += 6) {
      rect(c, xx + yy % 3, yy, 2, 4, "#b19a58");
      rect(c, xx + yy % 3 + 2, yy + 1, 2, 4, "#443d25");
    }
    rect(c, x, y, w, 4, "#557a30");
  }
  c.save();
  c.lineJoin = "round"; c.lineCap = "round";
  const pattern = c.createPattern(dirtTile(), "repeat")!;
  for (const path of paths) {
    c.beginPath();
    path.points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.strokeStyle = "#95af4b"; c.lineWidth = path.width + 3; c.stroke();
    c.strokeStyle = pattern; c.lineWidth = path.width; c.stroke();
    // Little turf bites soften the outline without changing the walkable corridor.
    for (let i = 1; i < path.points.length; i++) {
      const [ax, ay] = path.points[i - 1], [bx, by] = path.points[i];
      const length = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / length, ny = (bx - ax) / length;
      for (let d = 0; d < length; d += 3) for (const side of [-1, 1]) {
        const x = ax + (bx - ax) * d / length + nx * (path.width / 2 + 0.5) * side;
        const y = ay + (by - ay) * d / length + ny * (path.width / 2 + 0.5) * side;
        rect(c, x, y, 1 + Math.floor(hash(x, y, 8) * 3), 1, "#8b9e46");
      }
    }
  }
  c.restore();
  fillTiles(c, tile("stone", "#bdb78e", "#929779"), STREET_SPAWN.x - 28, STREET_SPAWN.y - 24, 76, 52);
  // Western vegetable patches, between the lots and lanes. Low edging stays walkable.
  for (const [x, y] of [[80, 216], [112, 472]]) {
    rect(c, x, y, 80, 48, "#83623b");
    for (let yy = 4; yy < 48; yy += 10) {
      rect(c, x + 3, y + yy + 4, 74, 2, "#513e28");
      for (let xx = 5; xx < 76; xx += 9)
        sprite(c, ["..l..", ".glg.", "glllg", ".ggg."],
          { g: "#3e7132", l: yy % 3 ? "#a9bb58" : "#d3b05d" }, x + xx, y + yy);
    }
    rect(c, x - 1, y - 1, 82, 2, "#b1945b");
    rect(c, x - 1, y + 47, 82, 2, "#b1945b");
  }
  // The creek runs north/south in the gap west of the central lane.
  const bridges: Array<[number, number]> = [];
  let bridgeStart = -1;
  for (let y = 0; y < STREET_H; y++) {
    const x = streamX(y);
    rect(c, x - 9, y, 18, 1, "#416d32"); rect(c, x - 8, y, 16, 1, "#b2ba71");
    rect(c, x - 7, y, 14, 1, "#438eab"); rect(c, x - 5, y, 10, 1, "#58b4cf");
    if (y % 7 === 1) rect(c, x - 3 + y % 3, y, 4, 1, "#a7d9da");
    const bridge = paths.some((p) => touchesPath({ x, y, w: 0, h: 0 }, p, 4));
    if (bridge && bridgeStart < 0) bridgeStart = y;
    if ((!bridge || y === STREET_H - 1) && bridgeStart >= 0) {
      bridges.push([bridgeStart, bridge ? y + 1 : y]); bridgeStart = -1;
    }
  }
  for (const [top, bottom] of bridges) {
    // Straight deck spans both banks even where the creek bends under it.
    const left = Math.min(...Array.from({ length: bottom - top }, (_, i) => streamX(top + i))) - 13;
    const right = Math.max(...Array.from({ length: bottom - top }, (_, i) => streamX(top + i))) + 13;
    rect(c, left, top, right - left, bottom - top, "#534a2d");
    for (let x = left + 1; x < right - 1; x += 4) {
      rect(c, x, top + 1, 3, bottom - top - 2, "#9d7a46");
      rect(c, x, top + 1, 1, bottom - top - 2, "#ccb075");
    }
    for (const y of [top, bottom - 2]) {
      rect(c, left - 1, y, right - left + 2, 2, "#725538");
      rect(c, left - 1, y, right - left + 2, 1, "#cfb17b");
    }
  }
  // Sparse, non-solid wildflowers make the open grass read as a meadow.
  for (let y = 48; y < STREET_H - 40; y += 19) for (let x = 48; x < STREET_W - 40; x += 23) {
    if (hash(x, y, 15) < 0.65 || Math.abs(x - streamX(y)) < 18 ||
      paths.some((p) => touchesPath({ x, y, w: 4, h: 4 }, p, 2))) continue;
    sprite(c, [".f.", "fLf", ".g."], { f: "#e1d582", L: "#fff1b5", g: "#3e782c" }, x, y);
  }
}
