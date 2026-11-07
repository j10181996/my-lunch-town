import type { Direction } from "../../shared/contracts";
import { ROADS, STREET_H, STREET_W } from "../../shared/town";
import { streetLayout, doorClearances, overlaps, touchesPath } from "../art/street-layout";

export interface TownFriend {
  id: string; name: string; kind: "cat" | "dog" | "bird" | "villager";
  avatar: string; route: Array<[number, number]>; phase: number;
}
export interface FriendPose { x: number; y: number; dir: Direction; moving: boolean; animT: number }
export function hashSeed(value: string) {
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function lifeWalkable(x: number, y: number) {
  if (x < 24 || y < 40 || x > STREET_W - 24 || y > STREET_H - 24) return false;
  const feet = { x: x - 7, y: y - 5, w: 14, h: 8 };
  const layout = streetLayout();
  if ([...layout.colliders, ...doorClearances()].some((r) => overlaps(feet, r))) return false;
  // 散步只走路邊與空地，留出道路、店門及溪流。
  if (ROADS.some((p) => touchesPath(feet, p))) return false;
  return Math.hypot(x - 528, y - 360) < 90 || layout.paths.some((p) => touchesPath(feet, p, 28));
}

export function safeSpot(x: number, y: number): [number, number] {
  for (let radius = 0; radius <= 160; radius += 8) {
    for (let dy = -radius; dy <= radius; dy += 8) {
      for (let dx = -radius; dx <= radius; dx += 8) {
        if (radius && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const px = Math.round(x / 8) * 8 + dx, py = Math.round(y / 8) * 8 + dy;
        if (lifeWalkable(px, py)) return [px, py];
      }
    }
  }
  return [528, 360];
}

export function createTownFriends(roomId: string): TownFriend[] {
  const specs = [
    ["cat", "橘子", 520, 352, "avatar-yellow"],
    ["dog", "飯糰", 552, 388, "avatar-blue"],
    ["villager", "散步的阿姨", 480, 360, "avatar-pink"],
    ["cat", "小芝麻", 720, 328, "avatar-purple"],
    ["bird", "啾啾", 448, 392, "avatar-green"],
    ["villager", "午休的阿伯", 608, 472, "avatar-green"],
  ] as const;
  return specs.map(([kind, name, x, y, avatar], i) => {
    let seed = hashSeed(`${roomId}:${i}`);
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const route = [safeSpot(x, y)];
    for (let step = 0; step < 10; step++) {
      const [cx, cy] = route[route.length - 1];
      const options: Array<[number, number]> = [[cx + 8, cy], [cx, cy + 8], [cx - 8, cy], [cx, cy - 8]];
      const prev = route[route.length - 2];
      const safe = options.filter(([nx, ny]) => lifeWalkable(nx, ny) &&
        (!prev || nx !== prev[0] || ny !== prev[1]));
      if (!safe.length) break;
      route.push(safe[random() % safe.length]);
    }
    // 原路返回形成連續迴圈；固定時間取樣，不會隨分頁停留時間漂移。
    route.push(...route.slice(1, -1).reverse());
    return { id: `friend-${i}`, name, kind, avatar, route, phase: random() % 20000 };
  });
}

export function friendPose(friend: TownFriend, now: number): FriendPose {
  const t = (now + friend.phase) / 1600;
  const index = Math.floor(t) % friend.route.length;
  const a = friend.route[index], b = friend.route[(index + 1) % friend.route.length];
  const fraction = t % 1;
  const moving = fraction < 0.65;
  const p = Math.min(1, fraction / 0.65);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return { x: a[0] + dx * p, y: a[1] + dy * p,
    dir: moving ? (Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "left" : "right" : dy < 0 ? "up" : "down")
      : (["down", "left", "up", "right"] as Direction[])[index % 4], moving, animT: now / 1000 };
}
