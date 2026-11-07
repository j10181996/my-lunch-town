import type { Meal, Store } from "../../shared/contracts";
import { BUILDING_H, BUILDING_W, LOTS, STREET_H, STREET_W, styleOf, type StyleDef } from "../../shared/town";
import { characterFrames, CHAR_W } from "./characters";
import { mealCanvas } from "./meals";
import { ctxOf, makeCanvas, rect, px, poly, ellipse, box, sprite, tint, hash, type Ctx2D } from "./pixel";
import { fillTiles, tile } from "./tiles";
import { streetLayout } from "./street-layout";
import { streetGround } from "./street-ground";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SignText {
  kind?: "store" | "road" | "vacant";
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  color: string;
}
/**
 * 陳列台上的一道商品（邏輯像素）：x 為圖片中心、y/size 為圖片位置；
 * zone 是玩家腳底要站進去才算「在這道菜前面」的範圍；labelY 是前板第一行（品名）的中心 y，價格在下一行。
 */
export interface ProductSlot {
  mealId: string;
  x: number;
  y: number;
  w: number;
  size: number;
  zone: Rect;
  labelY: number;
}
export interface SceneArt {
  background: HTMLCanvasElement;
  colliders: Rect[];
  signs: SignText[];
  foreground?: HTMLCanvasElement;
  products?: ProductSlot[];
}
const wood = { edge: "#62412f", dark: "#875332", base: "#b77b47", light: "#dca362", shine: "#f2c586" };
const icons: Record<StyleDef["icon"], string[]> = {
  bento: [
    "..........",
    ".oooooooo.",
    "owwwwggggo",
    "owwwghhhgo",
    "owwwhllhho",
    "owwwhhhmmo",
    "ommmmmmmmo",
    "oddddddddo",
    ".oooooooo.",
    "..........",
  ],
  noodle: [
    "......o.o.",
    ".....h.h..",
    "..hhhhhh..",
    ".ohllllho.",
    "ohllllllho",
    "oooooooooo",
    ".owwwwwwo.",
    "..oddddo..",
    "...oooo...",
    "..........",
  ],
  leaf: [
    "......ooo.",
    "....ooggo.",
    "...ogllgo.",
    "..oglllgo.",
    ".oglllggo.",
    "oglllggo..",
    "ogllggo...",
    ".ogggo....",
    "..ogo.....",
    "...o......",
  ],
  cup: [
    ".....rr...",
    ".....rr...",
    ".oooooooo.",
    ".owwwwwwo.",
    "..ohhhho..",
    "..olhhho..",
    "..olmmmo..",
    "..oddddo..",
    "...oooo...",
    "..........",
  ],
  curry: [
    "..........",
    "..oooooo..",
    ".owwwhhmo.",
    "owwwwlhmmo",
    "owwwwhmmmo",
    "owwwhmlmmo",
    ".owwhmmmo.",
    "..oooooo..",
    "..........",
    "..........",
  ],
  cake: [
    "....gg....",
    "...orro...",
    "..owrrwo..",
    ".owwwwwwo.",
    "owwwwwwwwo",
    "ohhhhhhddo",
    "orrrrrrddo",
    "ohhhhhhddo",
    ".oooooooo.",
    "..........",
  ],
};
export function drawIcon(c: Ctx2D, icon: StyleDef["icon"], x: number, y: number) {
  sprite(
    c,
    icons[icon],
    {
      o: "#3c2d2b",
      d: "#9b602e",
      m: "#d49038",
      h: "#efba62",
      l: "#ffe1a0",
      w: "#fff1d5",
      g: "#39913e",
      r: "#ed5260",
    },
    x,
    y,
  );
}
function timber(c: Ctx2D, x: number, y: number, w: number, h: number, color = wood.base) {
  box(c, x, y, w, h, color, wood.edge);
  rect(c, x + 1, y + 1, w - 2, 1, tint(color, 34));
  rect(c, x + w - 3, y + 2, 2, h - 3, tint(color, -25));
  for (let i = 4; i < h - 2; i += 4) {
    rect(c, x + 3, y + i, Math.max(1, w - 8), 1, tint(color, -13));
    if (w > 18) rect(c, x + 7, y + i + 1, 5, 1, tint(color, 18));
  }
}
function planter(c: Ctx2D, x: number, y: number, w = 18) {
  timber(c, x, y, w, 8, "#b88755");
  rect(c, x + 2, y + 1, w - 4, 2, "#70543a");
  for (let i = 0; i < w - 4; i += 5) {
    sprite(
      c,
      ["..g..", ".glg.", "glllg", ".glg.", "..g.."],
      { g: "#446e34", l: "#91b64f" },
      x + 1 + i,
      y - 4 - (i % 3),
    );
    px(c, x + 3 + i, y - 3, "#f7c95c");
    px(c, x + 4 + i, y - 4, "#fff0aa");
  }
}
export function drawStorefront(c: Ctx2D, bx: number, by: number, s: StyleDef, resting: boolean) {
  const r = (x: number, y: number, w: number, h: number, col: string) => rect(c, bx + x, by + y, w, h, col);
  const roofs: Record<string, string> = {
    bento: "#866338", noodle: "#987640", veg: "#737044",
    drink: "#71634d", curry: "#8f5937", cafe: "#705443",
  };
  const roof = roofs[s.key] ?? roofs.bento;
  const roofShade = tint(roof, -35);
  r(0, 30, 96, 34, "#3e3423");
  fillTiles(c, tile("wall", "#94713f", "#634a2d"), bx + 2, by + 32, 92, 31);
  r(88, 32, 6, 31, "#694e2f");
  for (const x of [2, 34, 59, 91]) timber(c, bx + x, by + 34, 3, 30, "#8a6538");
  poly(c, [
    [bx + 9, by], [bx + 87, by], [bx + 98, by + 30],
    [bx + 98, by + 34], [bx - 2, by + 34], [bx - 2, by + 30],
  ], "#3e3221");
  // Original wooden shakes, narrower and darker towards the eaves.
  for (let row = 0; row < 8; row++) {
    const yy = row * 4 + 1;
    const left = 9 - Math.floor(row * 1.4);
    const width = 96 - left * 2;
    r(left, yy, width, 4, tint(roof, 13 - row * 3));
    r(left, yy, width, 1, tint(roof, 35 - row * 3));
    r(left, yy + 3, width, 1, roofShade);
    for (let xx = left + (row % 2 ? 3 : 0); xx < 96 - left; xx += 6) {
      r(xx, yy + 1, 1, 3, tint(roof, -29));
      r(xx + 2, yy + 1, 1, 2, tint(roof, 12));
      if (xx + 4 < 96 - left) r(xx + 4, yy + 2, 1, 1, tint(roof, -16));
    }
  }
  timber(c, bx + 8, by, 80, 3, tint(roof, 17));
  r(-1, 32, 98, 3, "#42351f");
  for (let x = 1; x < 96; x += 5) {
    r(x, 32, 4, 2, "#a17b40");
    r(x, 34, 3, 1, "#5f4928");
  }
  // The nameboard stays in the preview overlay's original central band.
  timber(c, bx + 10, by + 20, 76, 14, "#aa8147");
  r(12, 22, 72, 10, "#e7d2a0");
  r(13, 23, 70, 1, "#f4e5bb");
  drawIcon(c, s.icon, bx + 13, by + 22);
  // A small dyed noren identifies the shop without recolouring the whole roof.
  r(36, 36, 24, 1, "#493922");
  for (let i = 0; i < 3; i++) {
    const col = tint(s.awningA, -18);
    r(37 + i * 8, 37, 7, 8, col);
    r(38 + i * 8, 37, 1, 6, tint(col, 30));
    r(42 + i * 8, 38, 2, 7, tint(col, -22));
    r(38 + i * 8, 43, 4, 1, "#d8c99c");
  }
  if (["bento", "noodle", "curry"].includes(s.key)) {
    timber(c, bx + 78, by + 3, 7, 14, "#79725a");
    r(77, 3, 9, 2, "#b0a080");
    r(79, 2, 5, 1, "#444936");
  } else if (s.key === "drink") {
    r(6, 38, 7, 6, "#4c705f");
    r(7, 39, 5, 1, "#b6bc82");
  } else {
    for (let yy = 36; yy < 61; yy += 3) {
      r(88 + yy % 3, yy, 2, 3, "#45622e");
      r(85 + yy % 3, yy, 3, 2, "#73903b");
      r(89, yy + 1, 2, 1, "#a5b85a");
    }
  }
  for (const x of [8, 66]) {
    timber(c, bx + x, by + 46, 22, 15, "#986236");
    r(x + 2, 48, 18, 10, resting ? "#323d32" : "#b7954f");
    r(x + 3, 49, 7, 7, resting ? "#485343" : "#e5c777");
    r(x + 4, 49, 2, 5, resting ? "#5a6250" : "#f3de98");
    r(x + 11, 48, 2, 11, wood.dark);
    r(x + 2, 54, 18, 1, wood.dark);
    r(x - 1, 60, 24, 2, wood.light);
    if (!resting) {
      r(x + 4, 56, 5, 2, "#b97d43");
      r(x + 14, 55, 3, 3, "#f9e2a0");
    }
  }
  timber(c, bx + 39, by + 46, 18, 18, "#9a643b");
  r(41, 48, 14, 9, resting ? "#30372c" : "#594b2c");
  r(42, 49, 4, 6, resting ? "#49503b" : "#8d7845");
  r(47, 48, 1, 10, wood.dark);
  r(41, 58, 14, 4, wood.dark);
  r(53, 58, 1, 2, "#fbd17b");
  if (resting) {
    poly(
      c,
      [
        [bx + 45, by + 53],
        [bx + 48, by + 50],
        [bx + 51, by + 53],
      ],
      wood.dark,
    );
    box(c, bx + 41, by + 53, 14, 7, "#ba9b64", wood.edge);
    r(42, 54, 12, 1, "#fff1d8");
  }
  // Threshold and stepping stones are ground decoration, never collision extensions.
  r(39, 63, 18, 1, "#b8b08a");
  poly(c, [[bx + 41, by + 65], [bx + 49, by + 64], [bx + 53, by + 67],
    [bx + 48, by + 70], [bx + 40, by + 69]], "#9e9e7d");
  r(43, 65, 6, 1, "#d0c8a4");
  planter(c, bx + 4, by + 60, 15);
  planter(c, bx + 78, by + 60, 15);
}
function emptyLot(c: Ctx2D, x: number, y: number) {
  rect(c, x + 3, y + 7, 90, 57, "#688943");
  fillTiles(c, tile("grass", "#7d9846", "#657b39"), x + 5, y + 9, 86, 53);
  fillTiles(c, tile("grass", "#ab9563", "#8c7c4a"), x + 32, y + 43, 32, 19);
  // Fence stays inside the lot, leaving all public paths clear.
  for (const fy of [y + 8, y + 59]) {
    rect(c, x + 4, fy + 2, 88, 2, wood.dark);
    for (let i = 5; i < 92; i += 9) {
      poly(
        c,
        [
          [x + i, fy - 3],
          [x + i + 2, fy - 5],
          [x + i + 4, fy - 3],
          [x + i + 4, fy + 6],
          [x + i, fy + 6],
        ],
        wood.dark,
      );
      rect(c, x + i + 1, fy - 3, 2, 8, wood.light);
    }
  }
  for (const xx of [x + 5, x + 89]) timber(c, xx, y + 10, 3, 48, "#c29a63");
  timber(c, x + 44, y + 34, 4, 21);
  timber(c, x + 25, y + 23, 46, 20, "#c99150");
  rect(c, x + 27, y + 25, 42, 16, "#fff0d0");
  rect(c, x + 28, y + 26, 40, 1, "#fff9e7");
  sprite(c, ["..g...g.", ".glg.glg", "..gggg..", "...gg..."], { g: "#75914b", l: "#b5c36b" }, x + 10, y + 47);
}
/** Overlapping leaf masses have a continuous dark underside and stippled sunlit crowns. */
function canopy(c: Ctx2D, x: number, y: number, _blossom: boolean) {
  const lobes = [[-7, -21, 10, 9], [4, -24, 11, 10], [-3, -31, 10, 8],
    [9, -15, 8, 8], [-8, -13, 9, 7], [0, -17, 12, 11]];
  const inside = (dx: number, dy: number) => lobes.some(([cx, cy, rx, ry]) =>
    ((dx - cx) / rx) ** 2 + ((dy - cy) / ry) ** 2 < 1);
  for (let dy = -40; dy < -5; dy++) {
    for (let dx = -18; dx <= 18; dx++) {
      if (!inside(dx, dy)) continue;
      const n = hash(x + dx, y + dy, 41);
      let level = 0;
      for (const [cx, cy, rx, ry] of lobes) {
        const d = ((dx - cx + 2) / rx) ** 2 + ((dy - cy + 3) / ry) ** 2;
        level = Math.max(level, d < 0.35 ? 3 : d < 0.65 ? 2 : d < 0.95 ? 1 : 0);
      }
      const colors = ["#305e22", "#447c25", "#5b942b", "#77ae31", "#94bc45"];
      if (n > 0.76 && level > 0) level++;
      if (n < 0.17 && level > 0) level--;
      if (!inside(dx, dy + 1) || !inside(dx + 1, dy)) level = 0;
      px(c, x + dx, y + dy, colors[level]);
      if (n > 0.97 && level >= 3) px(c, x + dx, y + dy, "#bad36a");
    }
  }
}

const crownCache = new Map<number, HTMLCanvasElement>();
function tree(bg: Ctx2D, fg: Ctx2D, x: number, y: number, blossom = false) {
  ellipse(bg, x + 3, y + 2, 12, 3, "#63794333");
  poly(
    bg,
    [
      [x - 3, y + 2],
      [x - 2, y - 13],
      [x - 6, y - 17],
      [x - 4, y - 18],
      [x, y - 14],
      [x + 4, y - 18],
      [x + 6, y - 17],
      [x + 2, y - 11],
      [x + 3, y + 2],
    ],
    wood.edge,
  );
  rect(bg, x - 1, y - 13, 2, 14, wood.base);
  rect(bg, x - 1, y - 11, 1, 10, wood.light);
  const variant = Math.abs(Math.round(x + y)) % 4;
  let crown = crownCache.get(variant);
  if (!crown) {
    crown = makeCanvas(40, 42);
    canopy(ctxOf(crown), 20 + variant % 2, 40, blossom);
    crownCache.set(variant, crown);
  }
  fg.drawImage(crown, x - 20, y - 40);
}
function lamp(c: Ctx2D, x: number, y: number) {
  // Low weathered stone lantern, rather than an urban iron streetlight.
  ellipse(c, x + 1, y + 1, 6, 2, "#354e2b44");
  rect(c, x - 4, y - 2, 9, 3, "#6b7055");
  rect(c, x - 3, y - 2, 6, 1, "#b7b390");
  rect(c, x - 1, y - 9, 3, 7, "#7e8466");
  box(c, x - 4, y - 14, 9, 6, "#646b50", "#49573f");
  rect(c, x - 2, y - 13, 5, 3, "#d8bd71");
  rect(c, x - 1, y - 13, 2, 2, "#f6df94");
  poly(c, [[x - 6, y - 14], [x - 3, y - 17], [x + 3, y - 17],
    [x + 7, y - 14]], "#8b9070");
  rect(c, x - 4, y - 15, 8, 1, "#c0be96");
}
function flowers(c: Ctx2D, x: number, y: number, w: number) {
  rect(c, x, y, w, 10, "#637e3c");
  rect(c, x, y + 9, w, 2, "#9c8053");
  rect(c, x, y + 8, w, 1, "#d8bc83");
  for (let i = 2; i < w - 2; i += 5) {
    rect(c, x + i, y + 2, 1, 6, "#486e36");
    const color = ["#f2a1ae", "#fff1c5", "#ebbb5d"][Math.floor(i / 5) % 3];
    sprite(c, [".f.", "fff", ".s."], { f: color, s: "#d39b50" }, x + i - 1, y + (i % 3));
    px(c, x + i + 1, y + 5, "#a9bc60");
  }
}
function barrel(c: Ctx2D, x: number, y: number) {
  ellipse(c, x + 1, y + 1, 6, 2, "#40532d66");
  box(c, x - 5, y - 11, 11, 12, "#967143", "#4d3d29");
  for (let dx = -3; dx <= 3; dx += 3) rect(c, x + dx, y - 9, 1, 9, "#c39d60");
  for (const yy of [-8, -2]) rect(c, x - 5, y + yy, 11, 2, "#575641");
  ellipse(c, x, y - 11, 5, 2, "#d0af73");
  rect(c, x - 3, y - 11, 7, 1, "#85663d");
}
function well(c: Ctx2D, x: number, y: number) {
  ellipse(c, x, y - 2, 8, 4, "#555940");
  ellipse(c, x, y - 3, 7, 3, "#b4b08b");
  ellipse(c, x, y - 4, 5, 2, "#263d3a");
  for (const dx of [-7, 6]) timber(c, x + dx, y - 19, 2, 19, "#926e3c");
  poly(c, [[x - 10, y - 18], [x, y - 25], [x + 10, y - 18]], "#4a3c27");
  poly(c, [[x - 8, y - 19], [x, y - 24], [x + 8, y - 19]], "#997943");
  rect(c, x, y - 18, 1, 13, "#c8b17d");
}
function shrub(c: Ctx2D, x: number, y: number) {
  ellipse(c, x, y, 8, 3, "#43712c");
  for (let dx = -6; dx <= 6; dx += 3) {
    sprite(c, ["..l..", "l.l.l", ".glg.", "..g.."],
      { g: "#4b802d", l: "#acc657" }, x + dx - 2, y - 6 + Math.abs(dx) % 3);
    if (dx % 2 === 0) sprite(c, [".f.", "fLf", ".g."],
      { f: "#c7a3d0", L: "#f5dfbd", g: "#507e2c" }, x + dx, y - 3);
  }
}
type StreetFront = Pick<Store, "id" | "name" | "styleKey" | "lotIndex">;

/** others：不在本團的店，畫成休息中的店面並標示「不在本團」，不提供進店入口。 */
export function buildStreet(stores: StreetFront[], restingIds: Set<string> = new Set(), others: StreetFront[] = []): SceneArt {
  const background = makeCanvas(STREET_W, STREET_H), foreground = makeCanvas(STREET_W, STREET_H);
  const c = ctxOf(background), f = ctxOf(foreground);
  const layout = streetLayout();
  const signs: SignText[] = [];
  streetGround(c, layout.paths);
  for (const lot of LOTS) {
    const store = stores.find((s) => s.lotIndex === lot.index);
    const other = store ? undefined : others.find((s) => s.lotIndex === lot.index);
    if (store) {
      drawStorefront(c, lot.bx, lot.by, styleOf(store.styleKey), restingIds.has(store.id));
      signs.push({ x: lot.bx + 25, y: lot.by + 27, w: 58, text: store.name, size: 7, color: "#593b2c" });
    } else if (other) {
      drawStorefront(c, lot.bx, lot.by, styleOf(other.styleKey), true);
      signs.push({ x: lot.bx + 25, y: lot.by + 27, w: 58, text: other.name, size: 7, color: "#7d6a5c" });
      // 告示板掛在雨棚上，讓「不在本團」不會和雨棚花色混在一起。
      box(c, lot.bx + 30, lot.by + 32, 48, 10, "#f4e6c4", "#6b4a2c");
      signs.push({ x: lot.bx + 32, y: lot.by + 37, w: 44, kind: "vacant", text: "不在本團", size: 6, color: "#7a3f22" });
    } else {
      emptyLot(c, lot.bx, lot.by);
      signs.push({ x: lot.bx + 28, y: lot.by + 33, w: 40, kind: "vacant", text: "招租中", size: 7, color: "#785334" });
    }
    for (const [dx, dy] of [[-3, 68], [2, 74]]) {
      poly(c, [[lot.bx + 44 + dx, lot.by + dy], [lot.bx + 51 + dx, lot.by + dy - 1],
        [lot.bx + 54 + dx, lot.by + dy + 2], [lot.bx + 49 + dx, lot.by + dy + 4],
        [lot.bx + 43 + dx, lot.by + dy + 3]], "#aaa483");
      rect(c, lot.bx + 46 + dx, lot.by + dy, 5, 1, "#dbd0ab");
    }
  }
  for (const prop of layout.props) {
    const { kind, x, y } = prop;
    if (kind === "tree") tree(c, f, x, y);
    else if (kind === "well") well(c, x, y);
    else if (kind === "barrel") barrel(c, x, y);
    else if (kind === "lamp") lamp(c, x, y);
    else {
      timber(c, x - 5, y - 10, 11, 12, "#ad824c");
      poly(c, [[x - 4, y - 8], [x - 2, y - 8], [x + 5, y], [x + 3, y]], "#e0ba77");
    }
  }
  for (const { text, x, y } of layout.signs) {
    timber(c, x - 2, y - 16, 4, 17, "#977044");
    const w = Math.max(30, text.length * 6 + 8);
    timber(c, x - w / 2, y - 20, w, 12, "#a47c47");
    rect(c, x - w / 2 + 2, y - 18, w - 4, 8, "#e7d2a0");
    signs.push({ x: x - w / 2 + 3, y: y - 14, w: w - 6, kind: "road", text, size: 5.5, color: "#593b2c" });
  }
  for (const [x, y, w] of [[744, 352, 40], [816, 384, 48], [592, 48, 40], [112, 284, 48]])
    flowers(c, x, y, w);
  // Low flowering shrubs are ground decoration; players can pass through their leaves.
  for (const [x, y] of [[740, 364], [872, 390], [192, 276], [600, 56], [680, 552], [232, 368]])
    shrub(c, x, y);
  return { background, foreground, colliders: layout.colliders, signs };
}
function pot(c: Ctx2D, x: number, y: number) {
  // One tile wide, two tiles high; the trunk/planter base owns the collision.
  ellipse(c, x, y + 5, 9, 2, "#4b56312a");
  poly(c, [[x - 8, y - 6], [x + 8, y - 6], [x + 6, y + 6], [x - 6, y + 6]], wood.edge);
  poly(c, [[x - 6, y - 5], [x + 6, y - 5], [x + 4, y + 4], [x - 4, y + 4]], "#d47140");
  rect(c, x - 5, y - 3, 2, 6, "#ffc17b");
  rect(c, x - 8, y - 7, 16, 3, "#f1a55f");
  rect(c, x - 7, y - 7, 14, 1, "#ffd994");
  rect(c, x - 1, y - 20, 2, 14, "#386d38");
  for (const [dx, dy] of [[-7, -22], [0, -25], [-8, -15], [0, -17]]) {
    sprite(c, ["..gg..", ".gllg.", "gllhlg", ".gmmg.", "..gg.."], {
      g: "#2d683c", m: "#459b43", l: "#92cd57", h: "#d4e786",
    }, x + dx, y + dy);
  }
}
/** 陳列台：每道菜佔 32px 寬，最多 3 道一台；台面高 10px、前板 18px（寫品名與價格）。 */
const SLOT_W = 32;
const STAND_TOP_H = 10;
const STAND_FRONT_H = 18;
const STAND_H = STAND_TOP_H + STAND_FRONT_H;
const ITEM_SIZE = 24; // 48px 原圖的 1/2

interface Stand {
  cx: number;
  sy: number;
  meals: Meal[];
}

/**
 * 依菜數決定陳列台位置（店內 384×216；櫃檯碰撞到 y 104、出口地墊在 x 172–212 的底部）：
 * 1–3 道：一台在正中間，從出生點 (192,192) 往上走就會停在它前面；
 * 4–6 道：中間左右各一台，兩台之間留 32px 走道通往櫃檯；
 * 7–12 道：左右兩側各上下兩台，中央 128px 走道通往出口。
 */
function layoutStands(meals: Meal[]): Stand[] {
  const n = meals.length;
  if (n === 0) return [];
  const spots: Array<[number, number]> =
    n <= 3 ? [[192, 130]] : n <= 6 ? [[124, 130], [260, 130]] : [[76, 116], [308, 116], [76, 168], [308, 168]];
  const base = Math.floor(n / spots.length);
  const extra = n % spots.length;
  let k = 0;
  return spots.map(([cx, sy], i) => {
    const count = base + (i < extra ? 1 : 0);
    const stand = { cx, sy, meals: meals.slice(k, k + count) };
    k += count;
    return stand;
  });
}

function standRect(st: Stand): Rect {
  const w = Math.max(56, st.meals.length * SLOT_W + 8);
  return { x: Math.round(st.cx - w / 2), y: st.sy, w, h: STAND_H };
}

function productSlots(stands: Stand[]): ProductSlot[] {
  return stands.flatMap((st) =>
    st.meals.map((m, i) => {
      const x = Math.round(st.cx - (st.meals.length * SLOT_W) / 2 + SLOT_W * i + SLOT_W / 2);
      return {
        mealId: m.id,
        x,
        y: st.sy + STAND_TOP_H - 2 - ITEM_SIZE,
        w: SLOT_W,
        size: ITEM_SIZE,
        zone: { x: x - SLOT_W / 2, y: st.sy + STAND_H + 2, w: SLOT_W, h: 18 },
        labelY: st.sy + STAND_TOP_H + 5.5,
      };
    }),
  );
}

/** 木製陳列台：店家識別色的桌巾、木台面、深色前板（給淺色文字）、短桌腳。 */
function drawStand(c: Ctx2D, r: Rect, accent: string) {
  rect(c, r.x + 2, r.y + r.h, r.w, 3, "#00000030");
  for (const dx of [3, r.w - 6]) rect(c, r.x + dx, r.y + r.h - 2, 3, 4, wood.edge);
  timber(c, r.x, r.y, r.w, STAND_TOP_H + 1, "#c79a5c");
  rect(c, r.x + 1, r.y + 1, r.w - 2, 2, "#f2cf8e");
  rect(c, r.x, r.y + STAND_TOP_H, r.w, STAND_FRONT_H, wood.edge);
  rect(c, r.x + 1, r.y + STAND_TOP_H, r.w - 2, STAND_FRONT_H - 1, "#563b30");
  rect(c, r.x + 1, r.y + STAND_TOP_H, r.w - 2, 2, accent);
  rect(c, r.x + 1, r.y + STAND_TOP_H + 2, r.w - 2, 1, tint(accent, -40));
}

export function buildShop(store: Store, meals: Meal[] = []): SceneArt {
  const style = styleOf(store.styleKey);
  const s = { ...style, counter: "#87603a" };
  const background = makeCanvas(384, 216),
    c = ctxOf(background);
  const signs: SignText[] = [],
    colliders: Rect[] = [];
  rect(c, 0, 0, 384, 216, "#080b08");
  fillTiles(c, tile("planks", "#ba985f", "#80643e"), 4, 80, 376, 136);
  fillTiles(c, tile("wall", "#c0b184", "#99865e"), 4, 8, 376, 72);
  rect(c, 0, 0, 384, 4, "#080b08");
  timber(c, 4, 8, 376, 7, s.counter);
  timber(c, 0, 70, 384, 10, s.counter);
  for (const x of [0, 48, 279, 379]) timber(c, x, 11, 5, 59, s.counter);
  // Dark cutaway edges frame the room without adding collision geometry.
  rect(c, 0, 80, 4, 136, "#080b08");
  rect(c, 380, 80, 4, 136, "#080b08");
  // A stone flue and stove occupy the left wall, clear of the nameboard.
  fillTiles(c, tile("stone", "#8e9177", "#666a52"), 18, 14, 14, 25);
  // The cream nameboard deliberately has no baked-in letters.
  timber(c, 65, 22, 172, 24, "#bd8448");
  rect(c, 68, 25, 166, 18, "#ffefca");
  rect(c, 70, 26, 162, 1, "#fff9e5");
  drawIcon(c, s.icon, 74, 29);
  signs.push({ x: 89, y: 34, w: 138, text: store.name, size: 12, color: "#583a29" });
  // Chalkboard: hand-set strokes, prices and little dish motif, no pseudo text on nameboards.
  timber(c, 291, 24, 72, 43, "#a97743");
  rect(c, 294, 27, 66, 37, "#3e5545");
  drawIcon(c, s.icon, 298, 30);
  for (let j = 0; j < 3; j++) {
    for (let k = 0; k < 4; k++) {
      rect(c, 299 + k * 5, 44 + j * 6, 3, 1, "#d6d8b3");
      px(c, 300 + k * 5, 43 + j * 6, "#bbc7a7");
    }
    rect(c, 342, 44 + j * 6, 10, 1, "#eee2ba");
  }
  rect(c, 312, 36, 38, 1, "#d2c9a3");
  rect(c, 348, 61, 8, 2, "#f3cc70");
  // Kitchen objects stay above the merchandise band (y 58–82).
  timber(c, 53, 51, 207, 5, s.counter);
  barrel(c, 273, 56);
  // Small iron stove and ceramic stockpot, above the reserved merchandise band.
  box(c, 15, 40, 22, 11, "#555449", "#363a31");
  rect(c, 18, 43, 7, 5, "#a66634");
  rect(c, 19, 44, 5, 2, "#dfaa4d");
  ellipse(c, 26, 40, 9, 3, "#343c34");
  box(c, 19, 32, 14, 8, "#8d9580", "#424c40");
  ellipse(c, 26, 32, 8, 2, "#bbc1a2");
  rect(c, 24, 29, 4, 2, "#424c40");
  for (let i = 0; i < 4; i++) {
    box(c, 57 + i * 12, 44, 10, 7, "#fff0cc", wood.edge);
    rect(c, 58 + i * 12, 45, 8, 1, "#ffffff");
    rect(c, 59 + i * 12, 49, 6, 1, "#bc9470");
  }
  for (const x of [118, 134, 150]) {
    ellipse(c, x, 49, 5, 2, "#594733");
    ellipse(c, x, 47, 4, 4, x === 134 ? "#969a76" : "#b58a58");
    rect(c, x - 2, 44, 4, 1, "#dfc698");
    rect(c, x - 1, 44, 2, 1, "#65533a");
    rect(c, x - 2, 46, 1, 3, "#d9bf8a");
  }
  const clerk = characterFrames("clerk").down[0];
  c.drawImage(clerk, 260 - CHAR_W / 2, 26);
  // Broad tiled worktop; the lower dark panels carry high-resolution price labels.
  fillTiles(c, tile("planks", "#b3935e", "#886d44"), 29, 58, 326, 24);
  // Deep counter front and individually lit boards.
  timber(c, 29, 78, 326, 25, s.counter);
  for (let x = 32; x < 352; x += 12) {
    rect(c, x, 83, 1, 18, tint(s.counter, -29));
    rect(c, x + 2, 85, 1, 12, tint(s.counter, 16));
  }
  rect(c, 30, 79, 324, 3, tint(s.counter, 46));
  rect(c, 30, 102, 324, 2, wood.edge);
  rect(c, 31, 86, 322, 12, "#563b30");
  rect(c, 31, 99, 322, 2, tint(s.counter, 28));
  // Register terminal and receipt roll.
  box(c, 297, 70, 27, 11, "#a49b86", "#65594c");
  poly(
    c,
    [
      [302, 71],
      [306, 53],
      [325, 53],
      [320, 71],
    ],
    "#504f4b",
  );
  poly(
    c,
    [
      [305, 68],
      [308, 55],
      [322, 55],
      [318, 68],
    ],
    "#87958a",
  );
  rect(c, 310, 57, 9, 2, "#bfc9aa");
  rect(c, 299, 73, 17, 1, "#e1d6bc");
  box(c, 328, 68, 9, 11, "#dac9a7", wood.edge);
  rect(c, 330, 65, 5, 7, "#fff0d0");
  // Pendant lamps, warm stepped glow, and bright left facets.
  for (const x of [53, 257, 374]) {
    ellipse(c, x, 32, 19, 14, "#ffe4a31a");
    ellipse(c, x, 32, 13, 9, "#ffdb8d26");
    rect(c, x, 8, 2, 13, "#67503b");
    poly(
      c,
      [
        [x - 7, 22],
        [x - 4, 18],
        [x + 5, 18],
        [x + 9, 23],
        [x + 9, 30],
        [x + 5, 34],
        [x - 4, 34],
        [x - 8, 30],
      ],
      "#916a32",
    );
    ellipse(c, x, 27, 8, 7, "#e8b34f");
    ellipse(c, x - 2, 26, 5, 5, "#ffdf7d");
    rect(c, x - 4, 22, 4, 7, "#fff2b6");
    rect(c, x - 5, 31, 10, 1, "#ffdb78");
  }
  // 商品陳列台：取代原本的用餐桌，依菜數擺 1、2 或 4 台
  const stands = layoutStands(meals);
  const products = productSlots(stands);
  for (const st of stands) {
    const r = standRect(st);
    drawStand(c, r, s.awningA);
    colliders.push(r);
  }
  for (const p of products) {
    const meal = meals.find((m) => m.id === p.mealId)!;
    ellipse(c, p.x, p.y + p.size - 1, p.size / 2 - 1, 2, "#00000030");
    ellipse(c, p.x, p.y + p.size - 2, p.size / 2, 2.5, "#fff3d6");
    c.drawImage(mealCanvas(meal.imageAssetKey), Math.round(p.x - p.size / 2), p.y, p.size, p.size);
  }
  for (const x of [15, 367]) {
    pot(c, x, 114);
    colliders.push({ x: x - 6, y: 108, w: 13, h: 12 });
  }
  // Doorway trim and a down-pointing arrow at the actual exit trigger.
  timber(c, 155, 211, 15, 5);
  timber(c, 214, 211, 15, 5);
  rect(c, 172, 204, 40, 12, "#8d4437");
  rect(c, 174, 205, 36, 11, "#ce6b56");
  rect(c, 175, 205, 34, 1, "#f29977");
  rect(c, 175, 214, 34, 1, "#a85142");
  poly(
    c,
    [
      [190, 207],
      [194, 207],
      [194, 210],
      [199, 210],
      [192, 215],
      [185, 210],
      [190, 210],
    ],
    "#fff0cb",
  );
  signs.push({ x: 166, y: 198, w: 52, text: "出口", size: 5, color: "#38251b" });
  colliders.push({ x: 0, y: 0, w: 384, h: 104 });
  return { background, colliders, signs, products };
}
export function storefrontPreview(styleKey: string, resting = false): HTMLCanvasElement {
  const c = makeCanvas(BUILDING_W + 8, BUILDING_H + 6),
    ctx = ctxOf(c);
  fillTiles(ctx, tile("grass"), 0, 64, c.width, 6);
  drawStorefront(ctx, 4, 0, styleOf(styleKey), resting);
  return c;
}
