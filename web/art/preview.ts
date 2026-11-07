import { AVATARS, MEAL_ART, STYLES, STREET_SPAWN, lotDoor } from "../../shared/town";
import catalog from "../../shared/catalog/stores.taichung.json";
import { tile, TILE, type TileKind } from "./tiles";
import type { Direction, Meal, Store } from "../../shared/contracts";
import { CHAR_H, CHAR_W, characterFrames, LOOKS } from "./characters";
import { MEAL_SIZE, mealCanvas } from "./meals";
import { buildShop, buildStreet, drawIcon, storefrontPreview, type SceneArt } from "./scenes";
import { ctxOf, makeCanvas } from "./pixel";
import { checkStreet } from "./street-check";
const style = document.createElement("style");
style.textContent = `
* { box-sizing: border-box; }
body { margin: 0; background: #f6edcf; color: #47362e; font: 14px system-ui, sans-serif; }
main { padding: 32px; max-width: 1560px; margin: auto; }
h1 { font-size: 30px; margin: 0 0 8px; }
h2 { font-size: 22px; margin: 34px 0 8px; }
p { color: #735b46; line-height: 1.7; }
section { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px;
  padding: 16px; background: #d6dfb8; border-radius: 8px; }
figure { margin: 0; padding: 12px; background: #fff5df; border: 2px solid #b3a17a;
  border-radius: 4px; max-width: 100%; overflow: auto; }
canvas { display: block; image-rendering: pixelated;
  background: repeating-conic-gradient(#e2d9c0 0% 25%, #f7edd7 0% 50%) 0/16px 16px; }
figcaption { margin-top: 9px; font: 12px ui-monospace, monospace; color: #70513a; }
label { display: inline-flex; gap: 6px; margin: 12px 20px 12px 0; }
input { accent-color: #4c963f; }
.note { margin: 0 0 12px; }
.directions { display: flex; gap: 10px; flex-wrap: wrap; }
header { border-bottom: 2px solid #b3a17a; padding-bottom: 16px; }
.badge { display: inline-block; padding: 5px 10px; background: #bce181; color: #35582e; }
`;
document.head.append(style);
const root = document.querySelector<HTMLElement>("#art-preview")!;
root.innerHTML = `
<header>
  <h1>午餐小鎮 · RPG 風格原創點陣圖鑑</h1>
  <p>木瓦村屋、彎曲泥土小徑、溪流木橋與層疊樹牆。
    全部以 Canvas 程式繪製，預覽放大 3 倍。</p>
  <span class="badge">角色 ${CHAR_W}×${CHAR_H} · 餐點 ${MEAL_SIZE}×${MEAL_SIZE} · 圖塊 ${TILE}×${TILE}</span>
  <div>
    <label><input id="signs" type="checkbox" checked>顯示招牌、餐點與價格文字</label>
    <label><input id="collision" type="checkbox">顯示碰撞範圍</label>
  </div>
</header>`;
function section(title: string, note: string) {
  const h = document.createElement("h2");
  h.textContent = title;
  root.append(h);
  const p = document.createElement("p");
  p.className = "note";
  p.textContent = note;
  root.append(p);
  const s = document.createElement("section");
  root.append(s);
  return s;
}
function card(parent: HTMLElement, source: HTMLCanvasElement, key: string, scale = 3) {
  const figure = document.createElement("figure"),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  ctxOf(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  const caption = document.createElement("figcaption");
  caption.textContent = key;
  figure.append(canvas, caption);
  parent.append(figure);
  return canvas;
}
const people = section(
  "01 / 角色與三幀步行",
  "每組依 down、up、right、left 排列；每方向從左到右為站立、步行 1、步行 2。" +
    "最底部一列留白，腳底中心固定。",
);
for (const id of [...AVATARS.map((a) => a.id), "clerk"]) {
  const group = document.createElement("figure");
  const title = document.createElement("figcaption");
  title.textContent = id;
  group.append(title);
  const row = document.createElement("div");
  row.className = "directions";
  group.append(row);
  for (const d of ["down", "up", "right", "left"] as Direction[]) {
    const sheet = makeCanvas(CHAR_W * 3, CHAR_H);
    characterFrames(id)[d].forEach((f, i) => ctxOf(sheet).drawImage(f, i * CHAR_W, 0));
    card(row, sheet, `${id} / ${d} / 0 · 1 · 2`);
  }
  people.append(group);
}
const meals = section(
  "02 / 餐點圖庫 · 三種實際尺寸",
  "每張依序為 48px、24px、16px；均用最近鄰縮放。",
);
for (const meal of MEAL_ART) {
  const group = document.createElement("figure");
  const row = document.createElement("div");
  row.className = "directions";
  group.append(row);
  for (const size of [48, 24, 16]) {
    const image = makeCanvas(size, size);
    ctxOf(image).drawImage(mealCanvas(meal.key), 0, 0, size, size);
    card(row, image, `${size}×${size}`);
  }
  const caption = document.createElement("figcaption");
  caption.textContent = `${meal.key} · ${meal.label}`;
  group.append(caption);
  meals.append(group);
}
const atlas = section(
  "02a / 16px 材質圖塊",
  "16px 材質圖塊；草地有四種變化，泥土道路依曲線遮罩收邊。",
);
for (const [kind, base, shade] of [
  ["grass", "#70a83b", "#568a2e"],
  ["stone", "#ddd3ad", "#abac8a"],
  ["roof", "#866338", "#634323"],
  ["wall", "#94713f", "#634a2d"],
  ["planks", "#ba985f", "#80643e"],
  ["floor", "#e4e8cf", "#c1c6a0"],
]) {
  const image = makeCanvas(64, 32);
  for (let y = 0; y < 32; y += TILE)
    for (let x = 0; x < 64; x += TILE)
      ctxOf(image).drawImage(tile(kind as TileKind, base, shade), x, y);
  card(atlas, image, kind);
}
const buildings = section(
  "03 / 六種店面 · 營業與休息",
  "招牌奶油色區域留白給店名；休息時熄燈並掛空白牌。店面預覽固定 104×70。",
);
for (const s of STYLES)
  for (const resting of [false, true])
    card(buildings, storefrontPreview(s.key, resting), `${s.key} / ${resting ? "resting" : "open"}`);
const icons = section("04 / 店面圖示", "每個圖示均限制在 10×10，置於 12×12 畫布的 (1,1)。");
for (const s of STYLES) {
  const c = makeCanvas(12, 12);
  drawIcon(ctxOf(c), s.icon, 1, 1);
  card(icons, c, `${s.key} / ${s.icon}`);
}
const demo: Store[] = catalog.stores.map((store) => ({
  ...store,
  sceneId: `shop:${store.id}`,
  interiorAssetKey: `interior-${store.styleKey}`,
  door: lotDoor(store.lotIndex),
}));
const scenes: Array<{ art: SceneArt; canvas: HTMLCanvasElement; players: boolean; scale: number }> = [];
function scene(parent: HTMLElement, art: SceneArt, key: string, players = false, scale = 3) {
  const canvas = card(parent, art.background, key, scale);
  if (scale === 1) {
    canvas.parentElement!.style.maxHeight = "520px";
    canvas.parentElement!.style.overflow = "auto";
  }
  scenes.push({ art, canvas, players, scale });
}
const started = performance.now();
const village = buildStreet(demo);
const buildTime = performance.now() - started;
const checks = checkStreet(village.colliders);
const overview = section("05 / 完整大地圖 · 縮小總覽", "960×608 世界；西側田園、中央井邊廣場、東側店街與南屯路。");
const result = document.createElement("p");
result.id = "street-check-result";
result.textContent = `${checks.passed ? "通過" : "失敗"}：${checks.reachableDoors}/12 門口可達 · ` +
  `4px BFS（8×4 腳底）${checks.visited} 格 · 門前／道路／出生點／建築碰撞檢查 · ` +
  `首次 buildStreet ${buildTime.toFixed(1)}ms`;
result.style.color = checks.passed ? "#35582e" : "#a12b24";
overview.before(result);
for (const failure of checks.failures) {
  const p = document.createElement("p"); p.textContent = failure; overview.before(p);
}
scene(overview, village, "village / overview / 75%", true, 0.75);
scene(section("05a / 原尺寸 · 可捲動", "以原尺寸查看地段、木橋、路標；勾選上方選項可疊上碰撞框。"),
  village, "village / 960×608 / 100%", true, 1);
const vacant = buildStreet(demo.slice(0, 3), new Set([demo[0].id]));
const vacantChecks = checkStreet(vacant.colliders);
scene(section("05b / 休息與空地", `營業與空地共用完整建築碰撞；可達性：` +
  `${vacantChecks.passed ? "通過" : vacantChecks.failures.join("；")}。`),
  vacant, "village / resting + vacant lots", false, 0.75);
const shops = section(
  "06 / 木屋店內與商品陳列",
  "慶飯飯便當的真實十二道菜單，以及單品情境。商品、價格與互動位置維持原樣。",
);
const chingfan = demo.find((store) => store.id === "store-chingfan")!;
const menu: Meal[] = catalog.meals.filter((m) => m.storeId === chingfan.id);
scene(shops, buildShop(chingfan, menu), "慶飯飯便當 / 12 meals / 16px items");
scene(shops, buildShop(chingfan, menu.slice(0, 1)), "慶飯飯便當 / 1 meal / 24px item");
for (const store of demo.filter((store) => store.id !== chingfan.id)) {
  const menu: Meal[] = catalog.meals.filter((m) => m.storeId === store.id);
  scene(shops, buildShop(store, menu), `${store.name} / ${menu.length} meals`);
}
function redraw() {
  const labels = (document.querySelector("#signs") as HTMLInputElement).checked,
    collision = (document.querySelector("#collision") as HTMLInputElement).checked;
  for (const { art, canvas, players, scale } of scenes) {
    const c = ctxOf(canvas);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.scale(scale, scale);
    c.drawImage(art.background, 0, 0);
    if (players) {
      Object.keys(LOOKS)
        .slice(0, 1)
        .forEach((id, i) => c.drawImage(characterFrames(id).down[0], STREET_SPAWN.x - CHAR_W / 2 + i * 16, STREET_SPAWN.y - CHAR_H + 1));
    }
    if (art.foreground) c.drawImage(art.foreground, 0, 0);
    c.restore();
    if (labels) {
      for (const s of art.signs) {
        c.fillStyle = s.color;
        c.font = `bold ${s.size * scale}px system-ui`;
        c.textBaseline = "middle";
        c.textAlign = "center";
        c.fillText(s.text, (s.x + s.w / 2) * scale, s.y * scale, s.w * scale);
      }
    }
    if (collision) {
      c.save();
      c.scale(scale, scale);
      for (const r of art.colliders) {
        c.fillStyle = "#dc53533d";
        c.fillRect(r.x, r.y, r.w, r.h);
        c.strokeStyle = "#ad4444";
        c.lineWidth = 0.5;
        c.strokeRect(r.x, r.y, r.w, r.h);
      }
      c.restore();
    }
  }
}
document.querySelectorAll("input").forEach((i) => i.addEventListener("change", redraw));
redraw();
// Lightweight assertions exercise artwork contracts without touching the game or server.
for (const id of Object.keys(LOOKS))
  for (const frames of Object.values(characterFrames(id)))
    if (frames.length !== 3 || frames.some((c) => c.width !== 24 || c.height !== 32))
      throw new Error(`Invalid frames: ${id}`);
for (const a of MEAL_ART) if (mealCanvas(a.key).width !== 48) throw new Error(`Invalid meal: ${a.key}`);
for (const s of STYLES)
  for (const rest of [false, true]) {
    const c = storefrontPreview(s.key, rest);
    if (c.width !== 104 || c.height !== 70) throw new Error(`Invalid storefront: ${s.key}`);
  }
