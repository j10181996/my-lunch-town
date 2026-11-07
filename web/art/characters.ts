import type { Direction } from "../../shared/contracts";
import { ctxOf, makeCanvas, rect, sprite, tint, type Ctx2D } from "./pixel";

export const CHAR_W = 24;
export const CHAR_H = 32;
interface Look {
  hair: string;
  shirt: string;
  pants: string;
  bag: string;
  hat?: string;
  kind?: "beanie" | "bucket" | "cap" | "scarf";
  bun?: boolean;
  glasses?: boolean;
  apron?: boolean;
}
export const LOOKS: Record<string, Look> = {
  "avatar-blue": { hair: "#293e79", shirt: "#71a34d", pants: "#45516b", bag: "#91a452", glasses: true },
  "avatar-pink": {
    hair: "#805133",
    shirt: "#d98b9d",
    pants: "#5f6881",
    bag: "#d97582",
    hat: "#c46d8c",
    kind: "beanie",
  },
  "avatar-purple": { hair: "#83579d", shirt: "#d88fa0", pants: "#52617b", bag: "#d6b34c", bun: true },
  "avatar-yellow": {
    hair: "#694833",
    shirt: "#528aa5",
    pants: "#5c625a",
    bag: "#bf8e50",
    hat: "#dcc15c",
    kind: "bucket",
  },
  "avatar-green": {
    hair: "#45463b",
    shirt: "#d7ba58",
    pants: "#617754",
    bag: "#a67b50",
    hat: "#548c47",
    kind: "cap",
  },
  clerk: {
    hair: "#78503a",
    shirt: "#f4e8ce",
    pants: "#685040",
    bag: "#d26050",
    hat: "#f8efda",
    kind: "scarf",
    apron: true,
  },
};
// Sixteen-pixel heads occupy half the 32px sprite; all masks are original.
const front = [
  ".....oooooooo.....",
  "...ooLLHHHHHHoo...",
  "..oLLLHHHHHHHHho..",
  ".oLLLHHHHHHHHHHho.",
  ".oLLHHHHHHHHHHHho.",
  "oLLHHHHHHHHHHHHhho",
  "oHHHHHHHHHHHHHHhho",
  "oHHHssHHHssHHHHhho",
  ".oHsSSsssSSsssHho.",
  ".oSSSSSSSSSSSSSso.",
  ".oSSSeSSSSSeSSSso.",
  ".oSSSeSSSSSeSSSso.",
  "..oSSSSSSSSSSSso..",
  "..oSSSSSmmSSSSso..",
  "...osSSSSSSSSso...",
  "....oooooooooo....",
];
const back = [
  ".....oooooooo.....",
  "...ooLLHHHHHHoo...",
  "..oLLLHHHHHHHHho..",
  ".oLLLHHHHHHHHHHho.",
  ".oLLHHHHHHHHHHHho.",
  "oLLHHHHHHHHHHHHhho",
  "oHHHHHHHHHHHHHHhho",
  "oHHHHHHHHHHHHHHhho",
  ".oHHHHHHHHHHHHHho.",
  ".oHHHHHHHHHHHHHho.",
  ".oHHHHHHHHHHHHhho.",
  ".oHHHHHHHHHHHHhho.",
  "..oHHHHHHHHHHhho..",
  "..oHhhhhhhhhhho...",
  "...ohhhhhhhhho....",
  "....oooooooooo....",
];
const side = [
  ".....oooooooo.....",
  "...ooLLHHHHHHoo...",
  "..oLLLHHHHHHHHho..",
  ".oLLLHHHHHHHHHHho.",
  ".oLLHHHHHHHHHHHho.",
  "oLLHHHHHHHHHHHHhho",
  "oHHHHHHHHHHHHHHhho",
  "oHHHHHHHHHHssSSso.",
  ".oHHHHHHHHsSSSSso.",
  ".oHHHHHHHHsSSSSso.",
  ".oHHHHHHHHsSSeSSo.",
  ".oHHHHHHHHsSSeSSSo",
  "..oHHHHHHssSSSSso.",
  "..oHHHHHssSSmmso..",
  "...oHHhhssSSSso...",
  "....oooooooooo....",
];
function draw(ctx: Ctx2D, l: Look, dir: "down" | "up" | "right", frame: number) {
  const bob = frame === 0 ? 0 : 1;
  const p: Record<string, string> = {
    o: "#302b36", H: l.hair, h: tint(l.hair, -28), L: tint(l.hair, 38),
    S: "#ffdaad", s: "#d99a77", e: "#302838", m: "#cd7d6d",
    c: l.shirt, d: tint(l.shirt, -36), a: tint(l.shirt, 35),
    b: l.bag, B: tint(l.bag, -37), P: l.pants, Q: tint(l.pants, 28), w: "#fff2d6",
  };
  // One foot always touches y=30, including both walk frames. Row 31 stays transparent.
  const feet = frame === 1 ? [0, -2] : frame === 2 ? [-2, 0] : [0, 0];
  for (let i = 0; i < 2; i++) {
    const x = 7 + i * 6;
    rect(ctx, x, 24 + bob, 4, 6 + feet[i] - bob, p.o);
    rect(ctx, x + 1, 25 + bob, 2, 3 + feet[i] - bob, p.P);
    rect(ctx, x + 1, 25 + bob, 1, 2, p.Q);
    rect(ctx, x - 1, 29 + feet[i], 6, 2, p.o);
    rect(ctx, x, 29 + feet[i], 3, 1, p.w);
  }
  sprite(ctx, [
    "...oooooo...",
    "..oaSSSado..",
    ".oacccccddo.",
    ".oacccccddo.",
    "oaccccccdddo",
    "oaccccccdddo",
    ".occccccddo.",
    ".occccccddo.",
    "..oddddddo..",
    "..oooooooo..",
  ], p, 6, 16 + bob);
  const arm = [".oo.", "oaco", "ocdo", "osSo", ".oo."];
  if (dir !== "right") sprite(ctx, arm, p, 4, 19 + bob + (frame === 1 ? 1 : 0));
  sprite(ctx, arm, p, dir === "right" ? 14 : 16, 19 + bob + (frame === 2 ? 1 : 0));
  if (!l.apron && dir === "down") {
    rect(ctx, 8, 18 + bob, 1, 6, p.B);
    rect(ctx, 15, 18 + bob, 1, 6, p.B);
    rect(ctx, 8, 18 + bob, 1, 2, p.b);
  }
  if (l.apron) {
    sprite(ctx, ["b....b", "bbbbbb", "babbBb", "bbbbBb", "bbwwBb", "bbbbBb", "BBBBBB"],
      { ...p, b: "#e44b45", B: "#9f3038", a: "#ff8171" }, 9, 18 + bob);
  } else if (dir === "up" || dir === "right") {
    sprite(ctx, [
      "..oooooo..",
      ".obbbbbbBo",
      "obaaaabbBo",
      "obbbbbbbBo",
      "obbbbbbbBo",
      "obBBbbBBBo",
      ".oBBBBBBo.",
      "..oooooo..",
    ], p, dir === "up" ? 7 : 3, 18 + bob);
  }
  sprite(ctx, dir === "down" ? front : dir === "up" ? back : side, p, 3, 1 + bob);
  if (dir !== "up") {
    // Tall two-block eyes, with a single pale glint; the bridge stays separate for glasses.
    const eyes = dir === "down" ? [8, 14] : [15];
    for (const x of eyes) {
      rect(ctx, x, 11 + bob, 2, 3, p.e);
      rect(ctx, x, 11 + bob, 1, 1, p.w);
    }
  }
  if (l.glasses) {
    sprite(ctx, ["..H..H..", ".HLHHHH.", "HHHHHHHH"], p, 8, 2 + bob);
    if (dir !== "up") {
      const rows = dir === "down" ? ["oooo.oooo", "o..ooo..o", "oooo.oooo"] : ["ooooo", "o...o", "ooooo"];
      sprite(ctx, rows, { o: "#302b36" }, dir === "down" ? 7 : 14, 10 + bob);
    }
  }
  if (l.bun) {
    sprite(ctx, ["..ooo..", ".oLLHo.", "oLLHHho", "oHHHhho", ".ohhho.", "..ooo.."],
      p, dir === "right" ? 3 : 13, bob);
  }
  if (l.hat) {
    const hp = { o: p.o, H: l.hat, h: tint(l.hat, -33), L: tint(l.hat, 34) };
    const hat = l.kind === "beanie" ? [
      ".....oooooo.....",
      "...ooLLHHHHoo...",
      "..oLLHHHHHHHho..",
      ".oLLHHHHHHHHhho.",
      ".oHHHHHHHHHHhho.",
      "oLhHHhHHhHHhHhho",
      ".oooooooooooooo.",
    ] : l.kind === "scarf" ? [
      ".....oooooo.....",
      "...ooLLLLLLoo...",
      "..oLLLLLLLLHHo..",
      ".oLLLLLLLLHHHHo.",
      "oLLLLLLLLHHHHHHo",
      ".ooooHHHHHooooo.",
    ] : [
      ".....oooooo.....",
      "...ooLLHHHHoo...",
      "..oLLHHHHHHHho..",
      "..oLHHHHHHHHho..",
      "..ohhhhhhhhhho..",
      ".oLLHHHHHHHHhho.",
      "oooooooooooooooo",
    ];
    sprite(ctx, hat, hp, 4, 2 + bob);
    if (l.kind === "cap") rect(ctx, dir === "right" ? 17 : 7, 8 + bob, 6, 2, hp.h);
    if (l.kind === "scarf" && dir === "up")
      sprite(ctx, [".LoL.", "LLoLL", ".H.H."], hp, 10, 11 + bob);
  }
}
type Frames = Record<Direction, HTMLCanvasElement[]>;
const cache = new Map<string, Frames>();
export function characterFrames(avatarId: string): Frames {
  const key = Object.hasOwn(LOOKS, avatarId) ? avatarId : "avatar-blue";
  const hit = cache.get(key);
  if (hit) return hit;
  const make = (d: "down" | "up" | "right", f: number) => {
    const c = makeCanvas(CHAR_W, CHAR_H);
    draw(ctxOf(c), LOOKS[key], d, f);
    return c;
  };
  const right = [0, 1, 2].map((f) => make("right", f));
  const left = right.map((src) => {
    const c = makeCanvas(CHAR_W, CHAR_H);
    const ctx = ctxOf(c);
    ctx.translate(CHAR_W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    return c;
  });
  const frames = {
    down: [0, 1, 2].map((f) => make("down", f)),
    up: [0, 1, 2].map((f) => make("up", f)),
    right,
    left,
  };
  cache.set(key, frames);
  return frames;
}
export function avatarDataUrl(avatarId: string): string {
  return characterFrames(avatarId).down[0].toDataURL();
}
