import { LOTS, ROADS, STREET_H, STREET_SPAWN, STREET_W } from "../../shared/town";
import type { Rect } from "./scenes";
import { doorClearances, overlaps, touchesPath } from "./street-layout";

export interface StreetCheck { passed: boolean; failures: string[]; reachableDoors: number; visited: number }
/** Pure validator, matching the game's 8×4 foot box and world boundary constraints. */
export function checkStreet(colliders: Rect[]): StreetCheck {
  const failures: string[] = [];
  const clearances = doorClearances();
  colliders.forEach((r, i) => {
    clearances.forEach((area, lot) => {
      if (overlaps(r, area)) failures.push(`地段 ${lot} 門前淨空區被碰撞框 ${i} 佔用`);
    });
    ROADS.forEach((road, roadIndex) => {
      if (touchesPath(r, road)) failures.push(`道路 ${roadIndex} 被碰撞框 ${i} 佔用`);
    });
    const dx = Math.max(r.x - STREET_SPAWN.x, 0, STREET_SPAWN.x - r.x - r.w);
    const dy = Math.max(r.y - STREET_SPAWN.y, 0, STREET_SPAWN.y - r.y - r.h);
    if (Math.hypot(dx, dy) < 32) failures.push(`出生點 32px 內有碰撞框 ${i}`);
  });
  LOTS.forEach(({ bx, by }, index) => {
    if (!colliders.some((r) => r.x <= bx && r.x + r.w >= bx + 96 &&
      r.y <= by && r.y + r.h === by + 64)) failures.push(`地段 ${index} 缺少完整建築碰撞框`);
  });
  const cols = STREET_W / 4, rows = STREET_H / 4;
  const blocked = (x: number, y: number) => x - 4 < 2 || y - 4 < 2 ||
    x + 4 > STREET_W - 2 || y > STREET_H - 1 ||
    colliders.some((r) => overlaps({ x: x - 4, y: y - 4, w: 8, h: 4 }, r));
  // Rasterize once; check the midpoint as well so a 4px step cannot jump a thin fence.
  const walkable = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    walkable[y * cols + x] = blocked(x * 4, y * 4) ? 0 : 1;
  const seen = new Uint8Array(cols * rows), queue: number[] = [];
  const start = STREET_SPAWN.y / 4 * cols + STREET_SPAWN.x / 4;
  if (walkable[start]) { queue.push(start); seen[start] = 1; }
  else failures.push("出生點無法站立");
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], x = id % cols, y = Math.floor(id / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[next] || !walkable[next]) continue;
      if (blocked(x * 4 + dx * 2, y * 4 + dy * 2)) continue;
      seen[next] = 1; queue.push(next);
    }
  }
  let reachableDoors = 0;
  LOTS.forEach(({ bx, by }, index) => {
    // y=by+68 is below the door trigger (by+70-1), with feet touching the facade at by+64.
    const id = (by + 68) / 4 * cols + (bx + 48) / 4;
    if (seen[id]) reachableDoors++;
    else failures.push(`地段 ${index} 門口無法從出生點抵達`);
  });
  return { passed: failures.length === 0, failures, reachableDoors, visited: queue.length };
}
