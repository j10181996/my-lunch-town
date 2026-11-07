import type { Direction } from "../../shared/contracts";
import { makeCanvas, ctxOf, sprite, rect } from "./pixel";

const cache = new Map<string, HTMLCanvasElement>();
/** 原創 24×24 像素動物，與現有角色共用整數像素放大。 */
export function animalFrame(kind: "cat" | "dog" | "bird", direction: Direction, frame: number, dark = false) {
  const key = `${kind}:${direction}:${frame}:${dark}`;
  if (cache.has(key)) return cache.get(key)!;
  const canvas = makeCanvas(24, 24), c = ctxOf(canvas);
  const palette = { o: "#493c32", f: dark ? "#727583" : kind === "cat" ? "#dca05b" : "#bb8c60",
    l: dark ? "#aeb1ba" : "#ffe0a2", w: "#fff2d7", e: "#302c32", p: "#e59a9d" };
  const side = direction === "left" || direction === "right";
  if (direction === "left") { c.translate(24, 0); c.scale(-1, 1); }
  if (kind === "bird") {
    sprite(c, ["..oooo...", ".offffo..", "offfweoo.", "offfwwop.", ".offffo..", "..oooo..."],
      { ...palette, f: "#8099a1", l: "#b6c9ca", p: "#ddaa4b" }, 8, 11);
    rect(c, 9, 17, 2, 2 + frame % 2, "#bd8a45");
    rect(c, 13, 17, 2, 3 - frame % 2, "#bd8a45");
  } else if (side) {
    sprite(c, [".........o..o..", "........ofoolo.", ".o......offffo.", "ofooooooffefeo.",
      "oflffffffffffo.", ".offlllllffwpo.", "..offfffffooo..", "...ooooooo....."], palette, 3, 7 + frame % 2);
    if (kind === "dog") rect(c, 16, 8, 3, 5, "#72503b");
    rect(c, 7 + frame % 2, 16, 2, 4 - frame % 2, palette.o);
    rect(c, 15 - frame % 2, 16, 2, 3 + frame % 2, palette.o);
  } else {
    sprite(c, ["..o......o..", ".of oooo fo.", ".offfffflfo.", ".offfffflfo.", "offeffeffffo",
      "offfwwfffffo", ".offppfflfo.", "..ooooooo...", "..offfffo...", ".offlllffo..", ".offlllffo..", "..ooooooo..."].map((r) => r.replaceAll(" ", ".")),
      direction === "up" ? { ...palette, e: palette.f, p: palette.f, w: palette.f } : palette, 6, 4 + frame % 2);
    if (kind === "dog") { rect(c, 6, 6, 3, 6, "#72503b"); rect(c, 15, 6, 3, 6, "#72503b"); }
    rect(c, 8, 16, 3, 3 + frame % 2, palette.o);
    rect(c, 14, 16, 3, 4 - frame % 2, palette.o);
  }
  cache.set(key, canvas);
  return canvas;
}
