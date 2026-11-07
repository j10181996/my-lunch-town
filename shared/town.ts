/** 街區、店面風格、素材索引：前後端共用的固定定義。 */
import type { Point } from "./contracts";

/** 每個場景的邏輯像素尺寸；對外座標一律換算成 0..1。 */
export const SCENE_W = 384;
export const SCENE_H = 216;

/** 店內鏡頭看得到的範圍（邏輯像素），等於店內大小。 */
export const VIEW_W = 384;
export const VIEW_H = 216;
/** 街上鏡頭看得到的範圍：比店內大 1.5 倍，一次看到更多村莊，人與房子在畫面上相對較小。 */
export const STREET_VIEW_W = 576;
export const STREET_VIEW_H = 324;
/** 街區（可探索地圖）的世界尺寸：約 2.5 × 2.8 個畫面（60 × 38 格），鏡頭跟著角色捲動。 */
export const STREET_W = 960;
export const STREET_H = 608;
/** 店內固定一個畫面大小。 */
export const SHOP_W = SCENE_W;
export const SHOP_H = SCENE_H;

export function sceneSize(sceneId: string): { w: number; h: number } {
  return sceneId === "street" ? { w: STREET_W, h: STREET_H } : { w: SHOP_W, h: SHOP_H };
}

export const BUILDING_W = 96;
export const BUILDING_H = 64;

export interface LotDef {
  index: number;
  /** 建築左上角（邏輯像素） */
  bx: number;
  by: number;
}

/**
 * 地段（建築左上角，皆朝南開門）。
 * 0–5 依台中六家種子店家的實際相對位置擺放（OpenStreetMap 街道等級座標等比例換算、對齊 16px 格）：
 *   0 壯壯餐盒（南屯大墩七街）、1 慶飯飯便當（西區昇平街）、2 Haritts（西區中興街，最北）、
 *   3 善倆號（南屯路二段，最西）、4 馬鈴薯輕食沙拉（西區五權西五街）、5 一日一味（南屯路一段，最南偏東）。
 * 6–11 為空地，留給新開的店。
 */
export const LOTS: LotDef[] = [
  { index: 0, bx: 384, by: 224 },
  { index: 1, bx: 640, by: 208 },
  { index: 2, bx: 688, by: 64 },
  { index: 3, bx: 64, by: 336 },
  { index: 4, bx: 592, by: 368 },
  { index: 5, bx: 800, by: 416 },
  { index: 6, bx: 96, by: 96 },
  { index: 7, bx: 224, by: 432 },
  { index: 8, bx: 416, by: 464 },
  { index: 9, bx: 480, by: 80 },
  { index: 10, bx: 816, by: 208 },
  { index: 11, bx: 208, by: 224 },
];

/** 進入街區時的出生點（世界座標，腳底）。 */
export const STREET_SPAWN = { x: 528, y: 360 };

/**
 * 主要道路（泥土路中心線，世界座標）。只是美術依據：遊戲沒有「只能走路上」的限制。
 * 南屯路串起善倆號（南屯路二段）與一日一味（南屯路一段），兩家店都真的在南屯路上。
 */
export const ROADS: Array<{ name: string | null; width: number; points: Array<[number, number]> }> = [
  { name: "南屯路", width: 28, points: [[0, 424], [112, 414], [320, 416], [560, 452], [848, 512], [960, 520]] },
  { name: null, width: 22, points: [[0, 320], [256, 302], [432, 318], [688, 290], [864, 302], [960, 300]] },
  { name: null, width: 22, points: [[0, 184], [144, 174], [528, 160], [800, 176], [960, 172]] },
  { name: null, width: 20, points: [[360, 0], [360, 184], [368, 318], [360, 424], [372, 608]] },
  { name: null, width: 18, points: [[784, 140], [800, 176]] },
];

/** 路標：每家種子店家附近立一塊，寫該店實際所在的街名。 */
export const STREET_SIGNS: Array<{ text: string; x: number; y: number }> = [
  { text: "大墩七街", x: 500, y: 318 },
  { text: "昇平街", x: 752, y: 286 },
  { text: "中興街", x: 800, y: 140 },
  { text: "南屯路二段", x: 176, y: 404 },
  { text: "五權西五街", x: 704, y: 444 },
  { text: "南屯路一段", x: 760, y: 506 },
];

/** 門口站位（建築正下方），0..1 座標。 */
export function lotDoor(index: number): Point {
  const lot = LOTS[index];
  return {
    x: round3((lot.bx + BUILDING_W / 2) / STREET_W),
    y: round3((lot.by + BUILDING_H + 6) / STREET_H),
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export interface StyleDef {
  key: string;
  label: string;
  wall: string;
  wallShade: string;
  roof: string;
  roofShade: string;
  awningA: string;
  awningB: string;
  floorA: string;
  floorB: string;
  innerWall: string;
  counter: string;
  icon: "bento" | "noodle" | "leaf" | "cup" | "curry" | "cake";
}

export const STYLES: StyleDef[] = [
  { key: "bento", label: "便當店", wall: "#f3dfb8", wallShade: "#d9b98a", roof: "#d0603a", roofShade: "#a2432a", awningA: "#e5483f", awningB: "#fbf2e4", floorA: "#f2d9b6", floorB: "#e6c79c", innerWall: "#f6e7c9", counter: "#a8683a", icon: "bento" },
  { key: "noodle", label: "麵店", wall: "#efe0c4", wallShade: "#cfb68f", roof: "#c8573a", roofShade: "#97402b", awningA: "#f2b631", awningB: "#fff5d6", floorA: "#efdcbc", floorB: "#dcc49c", innerWall: "#f8ecd2", counter: "#8e5a32", icon: "noodle" },
  { key: "veg", label: "蔬食", wall: "#e9ead0", wallShade: "#c8caa6", roof: "#c96a3e", roofShade: "#984c2c", awningA: "#4aa058", awningB: "#eef7e4", floorA: "#e4e8cf", floorB: "#cfd6b2", innerWall: "#eef2dc", counter: "#7b6a3e", icon: "leaf" },
  { key: "drink", label: "飲料店", wall: "#e5ecf2", wallShade: "#bccbd8", roof: "#4f7fb8", roofShade: "#365d8c", awningA: "#5aa7d8", awningB: "#f2f9ff", floorA: "#e8eef3", floorB: "#d3dde6", innerWall: "#eef4f8", counter: "#6c7f95", icon: "cup" },
  { key: "curry", label: "咖哩屋", wall: "#f5e3c0", wallShade: "#dbbd88", roof: "#9a4a2a", roofShade: "#73351e", awningA: "#e98a2c", awningB: "#fff1dc", floorA: "#f0dab2", floorB: "#e0c18f", innerWall: "#f7e6c4", counter: "#8a4f26", icon: "curry" },
  { key: "cafe", label: "甜點咖啡", wall: "#f7e4e2", wallShade: "#dcbab6", roof: "#7a5a4a", roofShade: "#5a4034", awningA: "#e58aa8", awningB: "#fff2f6", floorA: "#f4e2df", floorB: "#e5cbc6", innerWall: "#faeeed", counter: "#7a5240", icon: "cake" },
];

export const STYLE_KEYS = STYLES.map((s) => s.key);
export function styleOf(key: string | undefined): StyleDef {
  return STYLES.find((s) => s.key === key) ?? STYLES[0];
}

/** 點陣餐點圖庫；店家只能從這裡挑。 */
export const MEAL_ART: Array<{ key: string; label: string }> = [
  { key: "meal-chicken-bento", label: "雞腿便當" },
  { key: "meal-pork-bento", label: "排骨便當" },
  { key: "meal-vegetable-bento", label: "蔬菜便當" },
  { key: "meal-dry-noodle", label: "乾麵" },
  { key: "meal-wonton-noodle", label: "餛飩湯麵" },
  { key: "meal-sesame-noodle", label: "麻醬麵" },
  { key: "meal-tofu-rice", label: "豆腐飯" },
  { key: "meal-mushroom-bento", label: "菇菇便當" },
  { key: "meal-pumpkin-rice", label: "南瓜飯" },
  { key: "meal-curry-rice", label: "咖哩飯" },
  { key: "meal-fried-rice", label: "炒飯" },
  { key: "meal-dumpling", label: "水餃" },
  { key: "meal-soup", label: "湯品" },
  { key: "meal-salad", label: "沙拉" },
  { key: "meal-milk-tea", label: "奶茶" },
  { key: "meal-juice", label: "果汁" },
  { key: "meal-pudding", label: "布丁" },
  { key: "meal-cake", label: "蛋糕" },
  { key: "meal-generic", label: "通用便當" },
];
export const MEAL_ART_KEYS = MEAL_ART.map((m) => m.key);
export const DEFAULT_MEAL_ART = "meal-generic";

export const AVATARS = [
  { id: "avatar-blue", label: "藍" },
  { id: "avatar-pink", label: "粉" },
  { id: "avatar-purple", label: "紫" },
  { id: "avatar-yellow", label: "黃" },
  { id: "avatar-green", label: "綠" },
];
export const AVATAR_IDS = AVATARS.map((a) => a.id);

export const MAX_QTY_PER_MEAL = 20;

/** 各場景鏡頭範圍：街上看得廣，店內一個畫面。 */
export function viewSize(sceneId: string): { w: number; h: number } {
  return sceneId === "street" ? { w: STREET_VIEW_W, h: STREET_VIEW_H } : { w: VIEW_W, h: VIEW_H };
}
