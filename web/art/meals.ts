import { DEFAULT_MEAL_ART } from "../../shared/town";
import { ctxOf, makeCanvas, rect, ellipse, poly, sprite, type Ctx2D } from "./pixel";

export const MEAL_SIZE = 48;
const ink = "#443027";
const cream = "#fff5d2";

// Draw on a 24px item grid, then enlarge 2×: every outline is at least two source pixels.
function oval(c: Ctx2D, x: number, y: number, rx: number, ry: number, color: string) {
  ellipse(c, x, y, rx, ry, ink);
  ellipse(c, x, y - 0.5, rx - 1, ry - 1, color);
}
function greens(c: Ctx2D, x: number, y: number) {
  sprite(c, ["..gg.g..", ".gllglg.", "glllgllg", ".gllggg.", "..ggg..."], {
    g: "#28653a", l: "#8dbb51",
  }, x, y);
}
function egg(c: Ctx2D, x: number, y: number) {
  oval(c, x, y, 4, 3, cream);
  ellipse(c, x, y, 2, 2, "#ffb52e");
  rect(c, x - 1, y - 1, 1, 1, "#ffe983");
}
function rice(c: Ctx2D, x: number, y: number, golden = false) {
  oval(c, x, y, 7, 5, golden ? "#efb736" : cream);
  for (const [dx, dy] of [[-3, -2], [1, -3], [3, 0], [-1, 1], [-4, 1]])
    rect(c, x + dx, y + dy, 2, 1, golden ? "#ffe681" : "#dbc49b");
}
function tray(c: Ctx2D) {
  rect(c, 1, 5, 22, 16, ink);
  rect(c, 2, 6, 20, 13, "#b86b32");
  rect(c, 3, 7, 18, 10, "#f0bf6e");
  rect(c, 3, 19, 18, 1, "#e09c47");
  rice(c, 9, 12);
  greens(c, 14, 5);
}
function bowl(c: Ctx2D, color: string, blue = false) {
  poly(c, [[1, 10], [23, 10], [21, 18], [17, 22], [7, 22], [3, 18]], ink);
  poly(c, [[3, 11], [21, 11], [19, 17], [16, 20], [8, 20], [5, 17]], blue ? "#668e99" : "#b56b47");
  rect(c, 6, 16, 3, 2, blue ? "#bfd2bd" : "#ffba78");
  oval(c, 12, 10, 11, 6, cream);
  ellipse(c, 12, 10, 9, 4, color);
}
function plate(c: Ctx2D) {
  oval(c, 12, 16, 11, 6, "#aabbb0");
  ellipse(c, 12, 15, 9, 4, cream);
}
function cube(c: Ctx2D, x: number, y: number, color = "#ffe7a4") {
  rect(c, x, y, 5, 5, ink);
  rect(c, x + 1, y + 1, 3, 3, "#c8944b");
  rect(c, x + 1, y + 1, 3, 2, color);
}
function mushroom(c: Ctx2D, x: number, y: number) {
  sprite(c, ["..ooo..", ".ohhmo.", "ohhmmmo", "ooooooo", "..owo..", "..ooo.."], {
    o: ink, h: "#f7bb65", m: "#ad6035", w: cream,
  }, x, y);
}
function dumpling(c: Ctx2D, x: number, y: number) {
  sprite(c, ["...oo...", "..owwo..", ".owswwo.", "owswswwo", ".oooooo."], {
    o: ink, w: cream, s: "#dcb779",
  }, x, y);
}
function noodles(c: Ctx2D, sesame = false) {
  for (let y = 7; y < 14; y += 2) {
    rect(c, 5 + y % 3, y, 12, 1, sesame ? "#925b30" : "#b7822e");
    rect(c, 6 + y % 3, y - 1, 10, 1, sesame ? "#ebc27c" : "#ffe485");
  }
}
function scallions(c: Ctx2D) {
  for (const [x, y] of [[7, 7], [14, 8], [10, 12], [17, 12]]) {
    rect(c, x, y, 2, 2, "#31743c");
    rect(c, x, y, 1, 1, "#b0ca6b");
  }
}
function drink(c: Ctx2D, juice: boolean) {
  poly(c, [[5, 6], [20, 6], [18, 23], [8, 23]], ink);
  poly(c, [[7, 7], [18, 7], [16, 21], [10, 21]], juice ? "#dfa23b" : "#cf9560");
  rect(c, 8, 9, 2, 9, juice ? "#ffe994" : "#ffe4af");
  if (!juice) {
    for (const [x, y] of [[11, 18], [15, 18], [13, 21], [16, 21], [10, 21]])
      ellipse(c, x, y, 1.5, 1.5, ink);
  }
  oval(c, 12, 6, 8, 3, cream);
  rect(c, 14, 0, 2, 8, "#8a3343");
  rect(c, 14, 0, 1, 6, "#c87c72");
  if (juice) {
    oval(c, 19, 10, 4, 4, "#ffce3b");
    rect(c, 19, 7, 1, 6, cream);
    rect(c, 17, 10, 5, 1, cream);
  }
}
const recipes: Record<string, (c: Ctx2D) => void> = {
  "meal-chicken-bento": (c) => {
    tray(c);
    sprite(c, [
      "...oooo.....",
      "..ohhhmo....",
      ".ohllhmmo...",
      "ohllhmmmmo..",
      "ohhhmmmdmo..",
      ".ommmmddo...",
      "..oddddooo..",
      "...ooooowwo.",
      "........ooo.",
    ], { o: ink, h: "#f4a539", l: "#ffd66b", m: "#c26a28", d: "#8d4327", w: cream }, 6, 5);
    egg(c, 18, 16);
  },
  "meal-pork-bento": (c) => {
    tray(c);
    poly(c, [[5, 8], [15, 6], [20, 13], [17, 17], [8, 16], [4, 12]], ink);
    poly(c, [[6, 9], [14, 7], [18, 13], [16, 15], [8, 14]], "#d88036");
    for (let i = 0; i < 3; i++) rect(c, 8 + i * 3, 9, 1, 5, "#ffbf62");
  },
  "meal-vegetable-bento": (c) => {
    tray(c);
    greens(c, 5, 7);
    greens(c, 10, 12);
    for (let i = 0; i < 3; i++) {
      rect(c, 16 + i, 10 + i, 2, 6, ink);
      rect(c, 16 + i, 10 + i, 1, 5, "#ffa32e");
    }
  },
  "meal-tofu-rice": (c) => {
    tray(c);
    cube(c, 8, 7);
    cube(c, 14, 9);
    cube(c, 11, 14);
    scallions(c);
  },
  "meal-mushroom-bento": (c) => {
    tray(c);
    mushroom(c, 6, 6);
    mushroom(c, 13, 8);
    mushroom(c, 9, 13);
  },
  "meal-pumpkin-rice": (c) => {
    tray(c);
    for (let i = 0; i < 3; i++) {
      poly(c, [[7 + i * 4, 7], [10 + i * 4, 6], [14 + i * 4, 15], [10 + i * 4, 17]], "#385e32");
      poly(c, [[8 + i * 4, 8], [10 + i * 4, 7], [13 + i * 4, 14], [10 + i * 4, 15]], "#ffa82b");
      rect(c, 9 + i * 4, 9, 1, 3, "#ffe07a");
    }
  },
  "meal-generic": (c) => {
    tray(c);
    egg(c, 9, 9);
    cube(c, 12, 13, "#f0a94b");
    greens(c, 14, 9);
  },
  "meal-dry-noodle": (c) => {
    bowl(c, "#dcac53");
    noodles(c);
    rect(c, 10, 9, 5, 3, "#97502f");
    scallions(c);
  },
  "meal-sesame-noodle": (c) => {
    bowl(c, "#bc8548", true);
    noodles(c, true);
    for (let i = 0; i < 3; i++) rect(c, 16 + i, 6 + i, 1, 6, "#7dc453");
  },
  "meal-wonton-noodle": (c) => {
    bowl(c, "#eba837");
    noodles(c);
    dumpling(c, 3, 5);
    dumpling(c, 12, 6);
    dumpling(c, 8, 11);
  },
  "meal-soup": (c) => {
    bowl(c, "#eabf65", true);
    cube(c, 6, 7);
    cube(c, 13, 10);
    greens(c, 12, 4);
    rect(c, 8, 0, 1, 3, "#c0d6ca");
    rect(c, 12, 1, 1, 2, "#c0d6ca");
  },
  "meal-salad": (c) => {
    bowl(c, "#5aa641", true);
    greens(c, 2, 4);
    greens(c, 9, 2);
    greens(c, 14, 6);
    oval(c, 7, 11, 3, 3, "#c9643a");
    oval(c, 17, 10, 3, 3, "#c9643a");
    egg(c, 12, 14);
  },
  "meal-curry-rice": (c) => {
    plate(c);
    rice(c, 9, 11);
    oval(c, 16, 13, 6, 5, "#bc7026");
    cube(c, 13, 9, "#ffca52");
    cube(c, 16, 14, "#ef8b39");
    greens(c, 3, 5);
  },
  "meal-fried-rice": (c) => {
    plate(c);
    rice(c, 12, 11, true);
    for (const [x, y] of [[8, 9], [13, 6], [15, 11], [9, 13], [12, 11]]) {
      rect(c, x, y, 2, 2, "#e97537");
      rect(c, x + 1, y + 2, 2, 1, "#3e983e");
    }
  },
  "meal-dumpling": (c) => {
    plate(c);
    for (const [x, y] of [[3, 7], [11, 5], [14, 11], [6, 13]]) dumpling(c, x, y);
  },
  "meal-milk-tea": (c) => drink(c, false),
  "meal-juice": (c) => drink(c, true),
  "meal-pudding": (c) => {
    plate(c);
    poly(c, [[8, 5], [16, 5], [19, 16], [16, 19], [8, 19], [5, 16]], ink);
    poly(c, [[9, 6], [15, 6], [17, 16], [15, 17], [8, 17], [7, 15]], "#ffc747");
    rect(c, 9, 8, 2, 7, "#ffe791");
    oval(c, 12, 6, 5, 3, "#a8562c");
    sprite(c, ["..ww..", ".wwww.", "wwwwww"], { w: cream }, 9, 1);
  },
  "meal-cake": (c) => {
    plate(c);
    poly(c, [[4, 8], [14, 3], [21, 11], [20, 19], [5, 20]], ink);
    rect(c, 6, 10, 13, 8, "#f4bc65");
    rect(c, 6, 13, 13, 2, "#b65a62");
    rect(c, 6, 16, 13, 1, cream);
    poly(c, [[5, 8], [14, 4], [20, 11], [6, 12]], cream);
    oval(c, 13, 6, 3, 3, "#c8564c");
    rect(c, 12, 2, 3, 2, "#41853c");
    rect(c, 12, 5, 1, 1, "#ffc798");
  },
};
const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
export function mealCanvas(key: string): HTMLCanvasElement {
  const k = Object.hasOwn(recipes, key) ? key : DEFAULT_MEAL_ART;
  const hit = canvases.get(k);
  if (hit) return hit;
  const small = makeCanvas(24, 24);
  recipes[k](ctxOf(small));
  const canvas = makeCanvas(MEAL_SIZE, MEAL_SIZE);
  ctxOf(canvas).drawImage(small, 0, 0, MEAL_SIZE, MEAL_SIZE);
  canvases.set(k, canvas);
  return canvas;
}
export function mealImageUrl(key: string): string {
  const k = Object.hasOwn(recipes, key) ? key : DEFAULT_MEAL_ART;
  let url = urls.get(k);
  if (!url) {
    url = mealCanvas(k).toDataURL();
    urls.set(k, url);
  }
  return url;
}
