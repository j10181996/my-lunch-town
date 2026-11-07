import { LOTS, ROADS, STREET_H, STREET_SIGNS, STREET_SPAWN, STREET_W } from "../../shared/town";
import type { Rect } from "./scenes";

export type Point = [number, number];
export interface Path { width: number; points: Point[] }
export interface Prop { kind: "tree" | "well" | "barrel" | "lamp" | "crate"; x: number; y: number }
export interface RoadSign { text: string; x: number; y: number }
export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const buildings = () => LOTS.map(({ bx, by }) => ({ x: bx - 2, y: by, w: 100, h: 64 }));
export const doorClearances = () => LOTS.map(({ bx, by }) => ({ x: bx + 28, y: by + 64, w: 40, h: 32 }));

function pointDistance(x: number, y: number, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}
function segmentHits(r: Rect, a: Point, b: Point) {
  let lo = 0, hi = 1;
  for (const [p, d, min, max] of [[a[0], b[0] - a[0], r.x, r.x + r.w],
    [a[1], b[1] - a[1], r.y, r.y + r.h]]) {
    if (d === 0) { if (p < min || p > max) return false; }
    else {
      const t1 = (min - p) / d, t2 = (max - p) / d;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return false;
    }
  }
  return true;
}
/** Exact distance between a rectangle and the polyline's round-ended walking corridor. */
export function touchesPath(r: Rect, path: Path, margin = 0) {
  const corners: Point[] = [[r.x, r.y], [r.x + r.w, r.y],
    [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    if (segmentHits(r, a, b)) return true;
    const endpointDistance = (p: Point) => Math.hypot(
      Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
    const distance = Math.min(endpointDistance(a), endpointDistance(b),
      ...corners.map(([x, y]) => pointDistance(x, y, a, b)));
    if (distance < path.width / 2 + margin - 0.001) return true;
  }
  return false;
}
export const streamX = (y: number) => Math.round(336 + Math.sin(y / 62) * 4 + Math.sin(y / 27) * 2);

/** Door routes use a 4px search around the fixed lots, including north-facing road connections. */
function approach(bx: number, by: number): Path {
  const cols = STREET_W / 4, rows = STREET_H / 4;
  const start = (by + 80) / 4 * cols + (bx + 48) / 4;
  const parents = new Int32Array(cols * rows).fill(-1), queue = [start];
  parents[start] = start;
  const blocked = buildings();
  let end = -1;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], x = id % cols * 4, y = Math.floor(id / cols) * 4;
    if (ROADS.some((road) => touchesPath({ x, y, w: 0, h: 0 }, road))) { end = id; break; }
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const nx = x + dx * 4, ny = y + dy * 4, next = ny / 4 * cols + nx / 4;
      if (nx < 8 || ny < 8 || nx > STREET_W - 8 || ny > STREET_H - 8 || parents[next] !== -1) continue;
      if (blocked.some((r) => overlaps({ x: nx - 7, y: ny - 7, w: 14, h: 14 }, r))) continue;
      parents[next] = id; queue.push(next);
    }
  }
  if (end < 0) throw new Error(`No approach for lot ${bx},${by}`);
  const points: Point[] = [];
  for (let id = end; ; id = parents[id]) {
    points.push([id % cols * 4, Math.floor(id / cols) * 4]);
    if (id === start) break;
  }
  points.reverse(); points.unshift([bx + 48, by + 64]);
  // Keep corners, avoiding hundreds of redundant segments during rendering and checks.
  return { width: 10, points: points.filter((p, i) => i === 0 || i === points.length - 1 ||
    (p[0] - points[i - 1][0]) * (points[i + 1][1] - p[1]) !==
    (p[1] - points[i - 1][1]) * (points[i + 1][0] - p[0])) };
}

let cachedLayout: ReturnType<typeof createStreetLayout> | undefined;
export function streetLayout() {
  return cachedLayout ??= createStreetLayout();
}

function createStreetLayout() {
  const structures = buildings();
  const colliders = [...structures], approaches = LOTS.map(({ bx, by }) => approach(bx, by));
  const paths: Path[] = [...ROADS, ...approaches];
  const props: Prop[] = [], signs: RoadSign[] = [];
  const spawn = { x: STREET_SPAWN.x - 32, y: STREET_SPAWN.y - 32, w: 64, h: 64 };
  const clear = doorClearances();
  const safe = (r: Rect, margin = 0) => !colliders.some((b) => overlaps(r, b)) &&
    !clear.some((b) => overlaps(r, b)) && !overlaps(r, spawn) &&
    !paths.some((p) => touchesPath(r, p, margin));
  const addProp = (kind: Prop["kind"], x: number, y: number) => {
    const w = kind === "tree" ? 6 : kind === "well" ? 18 : 10;
    const base = { x: x - w / 2, y: y - 3, w, h: 6 };
    const visual = kind === "tree" ? { x: x - 18, y: y - 40, w: 36, h: 45 } :
      { x: x - 11, y: y - 25, w: 22, h: 30 };
    const plots: Rect[] = [{ x: 76, y: 212, w: 88, h: 56 }, { x: 108, y: 468, w: 88, h: 56 }];
    if (!safe(base, 4) || structures.some((b) => overlaps(visual, b)) ||
      clear.some((b) => overlaps(visual, b)) || overlaps(visual, spawn) ||
      plots.some((b) => overlaps(visual, b)) || paths.some((p) => touchesPath(visual, p, 4)) ||
      Math.abs(x - streamX(y)) < 22) return;
    props.push({ kind, x, y }); colliders.push(base);
    if (kind !== "tree") structures.push(visual);
  };
  addProp("well", 572, 376);
  for (const [x, y] of [[622, 340], [742, 240], [914, 456], [192, 368], [580, 128]]) {
    addProp("barrel", x, y); addProp("crate", x + 14, y + 3);
  }
  for (const [x, y] of [[580, 322], [774, 208], [748, 388], [906, 382]]) addProp("lamp", x, y);
  // Three ranks of trees frame the world; road exits remain open.
  for (let rank = 0; rank < 3; rank++) {
    for (let x = 12; x < STREET_W; x += 24) {
      addProp("tree", x + rank % 2 * 8, 14 + rank * 18);
      addProp("tree", x + rank % 2 * 8, STREET_H - 2 - rank * 18);
    }
    for (let y = 70; y < STREET_H - 45; y += 24) {
      addProp("tree", 10 + rank * 16, y); addProp("tree", STREET_W - 10 - rank * 16, y);
    }
  }
  // Western orchards and a northern copse; the east has smaller planted pockets.
  for (const [left, top, width, height] of [[64, 48, 240, 230], [64, 260, 130, 300],
    [400, 32, 250, 120], [580, 310, 330, 55], [700, 540, 180, 40]]) {
    for (let y = top; y < top + height; y += 32)
      for (let x = left; x < left + width; x += 30)
        if ((x * 7 + y * 3) % 11 < 7) addProp("tree", x, y);
  }
  const requests = [...STREET_SIGNS, ...ROADS.filter((r) => r.name).flatMap((r) =>
    [{ text: r.name!, x: 48, y: 424 }, { text: r.name!, x: STREET_W - 56, y: 520 }])];
  for (const request of requests) {
    let placed = false;
    // Coordinates designate the post base. Moving at most 24px keeps the original neighborhood.
    for (let distance = 0; distance <= 24 && !placed; distance += 2) {
      for (const [dx, dy] of [[0, -distance], [0, distance], [-distance, 0], [distance, 0]]) {
        const x = request.x + dx, y = request.y + dy;
        const base = { x: x - 2, y: y - 3, w: 4, h: 4 };
        if (!safe(base, 1)) continue;
        signs.push({ text: request.text, x, y }); colliders.push(base); placed = true; break;
      }
    }
    if (!placed) throw new Error(`Road sign cannot be placed within 24px: ${request.text}`);
  }
  // Water is solid between crossings; the actual bridge footprints stay walkable.
  for (let y = 0; y < STREET_H; y += 4) {
    const r = { x: streamX(y) - 6, y, w: 12, h: 4 };
    if (safe(r, 6)) colliders.push(r);
  }
  return { colliders, paths, approaches, props, signs };
}
