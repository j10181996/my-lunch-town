import { mealImagesVersion } from "../art/meals";
import { layoutMapLabels, type MapLabel } from "./text-layout";
import { animalFrame } from "../art/animals";
import { createTownFriends, friendPose, type TownFriend, type FriendPose } from "./town-life";
import { ACHIEVEMENTS, type Accessory, type AchievementId } from "./collection";
import type { Point, Direction, Meal, MoveInput, PlayerPresence, SceneId, Store } from "../../shared/contracts";
import { STREET_W, STREET_H, STREET_SPAWN, lotDoor, sceneSize, viewSize } from "../../shared/town";
import { CHAR_H, CHAR_W, characterFrames } from "../art/characters";
import { buildShop, buildStreet, type ProductSlot, type Rect, type SceneArt } from "../art/scenes";
import type { StreetStore } from "../../shared/contracts";

const SPEED = 84; // 邏輯像素／秒（大地圖走快一點，橫越約 11 秒）
const FOOT_W = 8;
const FOOT_H = 4;
const DOOR_RX = 14;
const DOOR_RY = 10;
/** 自動進店的水平容許範圍：約等於門寬（16px），斜著擦過門邊不會誤觸。 */
const DOOR_WALK_IN_RX = 9;
const EXIT = { x: 192, y: 205, rx: 18 };
const SEND_INTERVAL_MS = 100;
/** 陳列台前板上，價格行在品名行下方多少（邏輯像素）。 */
const PRODUCT_PRICE_DY = 7.5;

export interface GameMember {
  id: string;
  nickname: string;
  avatarId: string;
}

export interface GameCallbacks {
  onSceneChange(sceneId: SceneId): void;
  onNearDoor(store: Store | null): void;
  onMove(input: MoveInput): void;
  /** 站到櫃檯某個商品前（或離開時為 null）。 */
  onNearProduct(mealId: string | null): void;
  /** 在商品前按 Enter。 */
  onPickProduct(mealId: string): void;
  onNearFriend?(friend: { name: string; animal: boolean } | null): void;
  onPet?(): void;
  onCollect?(id: string): void;
}

interface Actor {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  animT: number;
}

interface Remote extends Actor {
  tx: number;
  ty: number;
  sceneId: SceneId;
  lastSeen: number;
  accessory?: Accessory;
  badge?: AchievementId;
}

/** Canvas 2D 小遊戲：一個邏輯緩衝區整數倍放大，再以高解析度補畫文字。 */
export class Game {
  private display: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private buffer = document.createElement("canvas");
  private bctx: CanvasRenderingContext2D;
  private scale = 1;
  private dpr = 1;

  private deliveryPoint: Point | null = null;
  /** 可進店的店：本團店家加上不在本團的街上店面。 */
  private stores: Store[] = [];
  private meals: Meal[] = [];
  private catalogKey = "";
  private nearProduct: ProductSlot | null = null;
  private myQty = new Map<string, number>();
  private sceneId: SceneId = "street";
  private art: SceneArt | null = null;
  private streetArt: SceneArt | null = null;
  private shopArt = new Map<string, SceneArt>();
  private mealImageVersion = 0;

  private me: Actor = { x: STREET_SPAWN.x, y: STREET_SPAWN.y, dir: "down", moving: false, animT: 0 };
  private meId = "";
  private members = new Map<string, GameMember>();
  private remotes = new Map<string, Remote>();
  private bubbles = new Map<string, { text: string; until: number }>();

  private friends: TownFriend[] = [];
  private friendPoses = new Map<string, FriendPose>();
  private nearFriend: TownFriend | null = null;
  private lifeEnabled = true;
  private social = true;
  private roomId = "";
  private accessory: Accessory = "none";
  private badge: AchievementId | undefined;
  private items: Array<{ id: string; x: number; y: number; icon: string }> = [];
  private lastInteraction = 0;

  setTownLife(roomId: string, enabled: boolean) {
    if (roomId !== this.roomId) { this.roomId = roomId; this.friends = createTownFriends(roomId); this.friendPoses.clear(); }
    this.lifeEnabled = enabled;
    if (!enabled) this.setNearFriend(null);
  }

  setSocial(enabled: boolean) { this.social = enabled; if (!enabled) this.bubbles.clear(); }
  setAppearance(accessory: Accessory, badge?: AchievementId) {
    if (this.accessory === accessory && this.badge === badge) return;
    this.accessory = accessory; this.badge = badge; this.dirty = true;
  }
  setCollectibles(items: typeof this.items) { this.items = items; }

  private setNearFriend(friend: TownFriend | null) {
    if (this.nearFriend?.id === friend?.id) return;
    this.nearFriend = friend;
    this.cb.onNearFriend?.(friend ? { name: friend.name, animal: friend.kind !== "villager" } : null);
  }

  interact() {
    if (!this.enabled || this.sceneId !== "street" || this.nearDoor || !this.nearFriend) return;
    const now = performance.now();
    if (now - this.lastInteraction < 800) return;
    this.lastInteraction = now;
    const friend = this.nearFriend;
    this.bubbles.set(friend.id, { text: friend.kind === "villager"
      ? ["今天也要記得吃午餐喔！", "沿著小路走，就能找到好吃的。", "聽說橘子最喜歡被摸摸了！"][Math.floor(now / 1000) % 3]
      : `♥ ${friend.name}開心地蹭了蹭你！`, until: now + 2600 });
    if (friend.kind !== "villager") this.cb.onPet?.();
  }

  private keys = new Set<string>();
  private nearDoor: Store | null = null;
  private exitArmed = true;
  private fade = 0;
  private seq = 0;
  private lastSent = 0;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private enabled = true;

  constructor(
    canvas: HTMLCanvasElement,
    private cb: GameCallbacks,
  ) {
    this.display = canvas;
    this.dctx = canvas.getContext("2d")!;
    this.bctx = this.buffer.getContext("2d")!;
    this.applyView();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  /* ——— 外部設定 ——— */

  private touchInput = { x: 0, y: 0 };

  setTouchInput(x: number, y: number) {
    if (!this.enabled || !Number.isFinite(x) || !Number.isFinite(y)) { this.touchInput = { x: 0, y: 0 }; return; }
    const length = Math.max(1, Math.hypot(x, y));
    this.touchInput = { x: x / length, y: y / length };
  }

  private resetInput() { this.keys.clear(); this.touchInput = { x: 0, y: 0 }; }

  /** 唯讀商品位置，供觸控端對端測試定位。 */
  debugProducts() { return this.art?.products ?? []; }

  /** 點擊店內陳列台；以實際 canvas 尺寸還原世界座標，避開 DPR 與留白。 */
  productAt(clientX: number, clientY: number): string | null {
    if (!this.enabled || this.sceneId === "street") return null;
    const rect = this.display.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const cam = this.camera();
    const x = (clientX - rect.left) / rect.width * this.view.w + cam.x;
    const y = (clientY - rect.top) / rect.height * this.view.h + cam.y;
    return this.art?.products?.find((p) => x >= p.x - p.w / 2 && x < p.x + p.w / 2
      && y >= p.y - 3 && y <= p.labelY + PRODUCT_PRICE_DY + 6)?.mealId ?? null;
  }

  private cssW = 0;
  private cssH = 0;

  /** 鏡頭範圍依場景不同：換場景時重設緩衝區大小與放大倍率。 */
  private applyView() {
    const v = this.view;
    if (this.buffer.width !== v.w || this.buffer.height !== v.h) {
      this.buffer.width = v.w;
      this.buffer.height = v.h;
      this.bctx.imageSmoothingEnabled = false;
    }
    if (this.cssW > 0) this.resize(this.cssW, this.cssH);
  }

  private get view() {
    return viewSize(this.sceneId);
  }

  resize(cssW: number, cssH: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    const { w: VIEW_W, h: VIEW_H } = this.view;
    this.dpr = window.devicePixelRatio || 1;
    let s = Math.min(cssW / VIEW_W, cssH / VIEW_H);
    // 讓「實體像素倍率」s×dpr 為整數：一般螢幕整數倍，Retina 可用 0.5 級距，像素仍銳利
    if (s * this.dpr >= 1) s = Math.floor(s * this.dpr) / this.dpr;
    this.scale = s;
    this.display.style.width = `${VIEW_W * s}px`;
    this.display.style.height = `${VIEW_H * s}px`;
    this.display.width = Math.round(VIEW_W * s * this.dpr);
    this.display.height = Math.round(VIEW_H * s * this.dpr);
  }

  /** streetStores 不在本團：一樣能進店看陳列台，是否能點由外層決定（#78）。 */
  setCatalog(stores: Store[], meals: Meal[], streetStores: StreetStore[] = []) {
    const sig = catalogSig(stores, meals, streetStores);
    this.stores = [...stores, ...streetStores.map(streetStoreAsStore)];
    this.meals = [...meals, ...streetStores.flatMap((s) => s.meals ?? [])];
    if (sig === this.catalogKey && this.streetArt) return;
    this.catalogKey = sig;
    this.streetArt = buildStreet(stores, new Set(stores.filter((s) => s.resting).map((s) => s.id)), streetStores);
    this.shopArt.clear();
    this.applySceneArt();
  }

  setDeliveryPoint(point: Point | null) {
    this.deliveryPoint = point;
  }

  setSelf(memberId: string) {
    this.meId = memberId;
  }

  setMembers(members: GameMember[]) {
    this.members = new Map(members.map((m) => [m.id, m]));
  }

  /** 自己已點的份數，畫在櫃檯商品上。 */
  setMyQuantities(q: Map<string, number>) {
    this.myQty = q;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.resetInput();
  }

  setPresence(players: PlayerPresence[]) {
    const now = performance.now();
    const seen = new Set<string>();
    for (const p of players) {
      if (p.memberId === this.meId) continue;
      seen.add(p.memberId);
      const size = sceneSize(p.sceneId);
      const tx = p.x * size.w;
      const ty = p.y * size.h;
      const r = this.remotes.get(p.memberId);
      if (!r || r.sceneId !== p.sceneId) {
        this.remotes.set(p.memberId, { x: tx, y: ty, tx, ty, dir: p.direction, moving: false, animT: 0, sceneId: p.sceneId, lastSeen: now, accessory: p.accessory, badge: p.badge });
      } else {
        r.accessory = p.accessory; r.badge = p.badge;
        r.tx = tx;
        r.ty = ty;
        r.dir = p.direction;
        r.lastSeen = now;
      }
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
  }

  showBubble(memberId: string, text: string) {
    if (!text) { this.bubbles.delete(memberId); return; }
    if (!this.social) return;
    this.bubbles.set(memberId, { text, until: performance.now() + 2600 });
  }

  /** 目前場景的世界尺寸（邏輯像素）。 */
  private get world() {
    return sceneSize(this.sceneId);
  }

  /** 鏡頭左上角：以自己為中心，碰到地圖邊界就停；地圖比畫面小時置中。 */
  private camera(): { x: number; y: number } {
    const w = this.world;
    const axis = (pos: number, view: number, size: number) =>
      size <= view ? Math.round((size - view) / 2) : Math.round(Math.min(size - view, Math.max(0, pos - view / 2)));
    const v = this.view;
    return { x: axis(this.me.x, v.w, w.w), y: axis(this.me.y - 12, v.h, w.h) };
  }

  /** 唯讀的除錯資訊：自動化測試用來導航（不提供任何改變狀態的方法）。 */
  debugState() {
    return { x: this.me.x, y: this.me.y, scene: this.sceneId, nearDoor: this.nearDoor?.id ?? null, nearProduct: this.nearProduct?.mealId ?? null,
      nearFriend: this.nearFriend?.name ?? null, friends: this.visibleFriends().map((f) => ({ ...f, pose: this.friendPoses.get(f.id) })),
      bubbles: [...this.bubbles].filter(([, b]) => b.until > performance.now()), accessory: this.accessory,
      items: this.items, remotes: [...this.remotes].map(([id, r]) => ({ id, scene: r.sceneId, accessory: r.accessory, badge: r.badge })) };
  }

  get scene(): SceneId {
    return this.sceneId;
  }

  /** 進店（E 鍵、點擊提示或面板的「前往店家」皆走這裡）。 */
  enterStore(storeId: string) {
    const store = this.stores.find((s) => s.id === storeId);
    if (!store) return;
    this.sceneId = store.sceneId;
    this.me = { x: EXIT.x, y: 192, dir: "up", moving: false, animT: 0 };
    this.exitArmed = true;
    this.fade = 1;
    this.resetInput();
    this.applySceneArt();
    this.applyView();
    this.setNearDoor(null);
    this.setNearFriend(null);
    this.setNearProduct(null);
    this.cb.onSceneChange(this.sceneId);
    this.sendMove(true);
  }

  /** 回街上，出生在該店門外，不會立即再進店（需再按 E）。 */
  leaveStore() {
    // 任務也會呼叫返回街道；已在街上時不可套用出店座標，避免落入建築碰撞區。
    if (this.sceneId === "street") return;
    const storeId = this.sceneId.startsWith("shop:") ? this.sceneId.slice(5) : null;
    const store = this.stores.find((s) => s.id === storeId);
    this.sceneId = "street";
    const door = store?.door ?? { x: 0.5, y: 0.45 };
    const w = this.world;
    this.me = { x: door.x * w.w, y: door.y * w.h + 6, dir: "down", moving: false, animT: 0 };
    this.fade = 1;
    this.resetInput();
    this.applySceneArt();
    this.applyView();
    this.setNearProduct(null);
    this.cb.onSceneChange(this.sceneId);
    this.sendMove(true);
  }

  /* ——— 內部 ——— */

  private applySceneArt() {
    if (this.sceneId === "street") {
      this.art = this.streetArt;
      return;
    }
    const id = this.sceneId.slice(5);
    let art = this.shopArt.get(id);
    const store = this.stores.find((s) => s.id === id);
    if (!art && store) {
      art = buildShop(
        store,
        this.meals.filter((m) => m.storeId === id),
      );
      this.shopArt.set(id, art);
    }
    this.art = art ?? this.streetArt;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
      // 開始走路就把焦點從側欄按鈕移開，之後的 Enter 才會交給遊戲而不是再按一次那顆按鈕
      if (t && (t.tagName === "BUTTON" || t.tagName === "A")) t.blur();
    } else if (k === "enter" && this.nearProduct && !e.repeat) {
      if (t && (t.tagName === "BUTTON" || t.tagName === "A")) return; // 交給被聚焦的按鈕
      e.preventDefault();
      this.cb.onPickProduct(this.nearProduct.mealId);
    } else if (k === "enter" && this.nearFriend && !e.repeat) {
      if (t && (t.tagName === "BUTTON" || t.tagName === "A")) return;
      e.preventDefault();
      this.interact();
    } else if (k === "e" && this.nearDoor) {
      this.enterStore(this.nearDoor.id);
    } else if (k === "escape" && this.sceneId !== "street") {
      this.leaveStore();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => this.resetInput();

  private blocked(x: number, y: number): boolean {
    const fx = x - FOOT_W / 2;
    const fy = y - FOOT_H;
    const w = this.world;
    if (fx < 2 || fy < 2 || fx + FOOT_W > w.w - 2 || y > w.h - 1) return true;
    for (const r of this.art?.colliders ?? []) {
      if (fx < r.x + r.w && fx + FOOT_W > r.x && fy < r.y + r.h && fy + FOOT_H > r.y) return true;
    }
    return false;
  }

  private setNearProduct(p: ProductSlot | null) {
    if (p?.mealId === this.nearProduct?.mealId) return;
    this.nearProduct = p;
    this.cb.onNearProduct(p?.mealId ?? null);
  }

  private setNearDoor(store: Store | null) {
    if (store?.id === this.nearDoor?.id) return;
    this.nearDoor = store;
    this.cb.onNearDoor(store);
  }

  private visibleFriends() {
    if (!this.lifeEnabled || this.sceneId !== "street") return [];
    return this.friends.slice(0, this.cssW < 600 ? 3 : 6);
  }

  private update(dt: number) {
    let vx = this.touchInput.x;
    let vy = this.touchInput.y;
    const k = this.keys;
    if (k.has("arrowleft") || k.has("a")) vx -= 1;
    if (k.has("arrowright") || k.has("d")) vx += 1;
    if (k.has("arrowup") || k.has("w")) vy -= 1;
    if (k.has("arrowdown") || k.has("s")) vy += 1;
    const me = this.me;
    const wasMoving = me.moving;
    me.moving = vx !== 0 || vy !== 0;
    if (me.moving) {
      const len = Math.max(1, Math.hypot(vx, vy));
      const nx = me.x + (vx / len) * SPEED * dt;
      const ny = me.y + (vy / len) * SPEED * dt;
      if (!this.blocked(nx, me.y)) me.x = nx;
      if (!this.blocked(me.x, ny)) me.y = ny;
      me.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
      me.animT += dt;
      this.dirty = true;
    } else if (wasMoving) {
      this.dirty = true;
    }

    if (this.sceneId === "street") {
      const near = this.stores.find((s) => {
        const dx = s.door.x * this.world.w;
        const dy = s.door.y * this.world.h;
        return Math.abs(me.x - dx) < DOOR_RX && Math.abs(me.y - dy) < DOOR_RY;
      });
      this.setNearDoor(near ?? null);
      // 和出店踩地墊一樣：往上走進門框就直接進店（E 與按鈕仍可用）
      if (near && vy < 0) {
        const dx = near.door.x * this.world.w;
        const dy = near.door.y * this.world.h;
        if (Math.abs(me.x - dx) < DOOR_WALK_IN_RX && me.y <= dy - 1) {
          this.enterStore(near.id);
          return;
        }
      }
    } else {
      const near = (this.art?.products ?? []).find(
        (p) => me.x >= p.zone.x && me.x < p.zone.x + p.zone.w && me.y >= p.zone.y && me.y < p.zone.y + p.zone.h,
      );
      this.setNearProduct(near ?? null);
      const onMat = me.y >= EXIT.y && Math.abs(me.x - EXIT.x) < EXIT.rx;
      if (!onMat) this.exitArmed = true;
      else if (this.exitArmed && me.moving) this.leaveStore();
    }

    const friends = this.visibleFriends();
    for (const f of friends) {
      const pose = friendPose(f, Date.now());
      const previous = this.friendPoses.get(f.id);
      // 玩家靠近時停下來，偏差最多一格；NPC 沒有實體碰撞，不會擋路。
      const players = [me, ...[...this.remotes.values()].filter((r) => r.sceneId === "street")];
      const close = players.some((p) => Math.hypot(p.x - pose.x, p.y - pose.y) < 12);
      this.friendPoses.set(f.id, close && previous && Math.hypot(previous.x - pose.x, previous.y - pose.y) < 8
        ? { ...previous, moving: false } : pose);
    }
    this.setNearFriend(this.nearDoor ? null : friends.find((f) => {
      const p = this.friendPoses.get(f.id)!;
      return Math.hypot(p.x - me.x, p.y - me.y) < 28;
    }) ?? null);
    if (this.sceneId === "street") {
      const collected = this.items.filter((item) => Math.hypot(item.x - me.x, item.y - me.y) < 13);
      this.items = this.items.filter((item) => !collected.includes(item));
      for (const item of collected) this.cb.onCollect?.(item.id);
    }

    for (const r of this.remotes.values()) {
      const dx = r.tx - r.x;
      const dy = r.ty - r.y;
      const dist = Math.hypot(dx, dy);
      r.moving = dist > 0.5;
      if (dist > 60) {
        r.x = r.tx;
        r.y = r.ty;
      } else if (r.moving) {
        const step = Math.min(dist, SPEED * 1.15 * dt);
        r.x += (dx / dist) * step;
        r.y += (dy / dist) * step;
        r.animT += dt;
      }
    }

    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 3.5);

    const now = performance.now();
    if (this.dirty && now - this.lastSent >= SEND_INTERVAL_MS) this.sendMove(false);
  }

  private sendMove(force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastSent < SEND_INTERVAL_MS) return;
    this.lastSent = now;
    // 強制換場／重連後補送一次，避免撞上伺服器的移動節流而停留在舊場景。
    this.dirty = force;
    this.cb.onMove({
      accessory: this.accessory,
      badge: this.social ? this.badge : undefined,
      sceneId: this.sceneId,
      x: Math.min(1, Math.max(0, this.me.x / this.world.w)),
      y: Math.min(1, Math.max(0, this.me.y / this.world.h)),
      direction: this.me.dir,
      seq: ++this.seq,
    });
  }

  /** 首次連線後送出目前位置，讓他人看得到。 */
  announce() {
    this.sendMove(true);
  }

  private frameOf(a: Actor) {
    if (!a.moving) return 0;
    return Math.floor(a.animT * 8) % 2 === 0 ? 1 : 2;
  }

  private render() {
    if (this.mealImageVersion !== mealImagesVersion()) {
      this.mealImageVersion = mealImagesVersion();
      this.shopArt.clear();
      this.applySceneArt();
    }
    const b = this.bctx;
    const cam = this.camera();
    const v = this.view;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = "#000";
    b.fillRect(0, 0, v.w, v.h);
    b.setTransform(1, 0, 0, 1, -cam.x, -cam.y); // 以下以世界座標繪製
    if (this.art) b.drawImage(this.art.background, 0, 0);
    if (this.nearProduct) drawProductHighlight(b, this.nearProduct, performance.now());

    type Draw = { id: string; a: Actor; avatarId: string; name: string; self: boolean; friend?: TownFriend; accessory?: Accessory; badge?: AchievementId };
    const draws: Draw[] = [];
    const meMember = this.members.get(this.meId);
    draws.push({ id: this.meId, a: this.me, avatarId: meMember?.avatarId ?? "avatar-blue", name: meMember?.nickname ?? "我", self: true, accessory: this.accessory, badge: this.social ? this.badge : undefined });
    for (const [id, r] of this.remotes) {
      if (r.sceneId !== this.sceneId) continue;
      const m = this.members.get(id);
      draws.push({ id, a: r, avatarId: m?.avatarId ?? "avatar-blue", name: m?.nickname ?? "…", self: false, accessory: r.accessory, badge: this.social ? r.badge : undefined });
    }
    for (const f of this.visibleFriends()) {
      const p = this.friendPoses.get(f.id);
      if (p) draws.push({ id: f.id, a: p, avatarId: f.avatar, name: f.name, self: false, friend: f });
    }
    draws.sort((p, q) => p.a.y - q.a.y);
    for (const d of draws) {
      b.fillStyle = "#00000030";
      b.fillRect(Math.round(d.a.x - 5), Math.round(d.a.y - 1), 10, 2);
      const animal = d.friend && d.friend.kind !== "villager";
      const sprite = animal ? animalFrame(d.friend!.kind as "cat" | "dog" | "bird", d.a.dir, this.frameOf(d.a), d.friend!.name === "小芝麻")
        : characterFrames(d.avatarId)[d.a.dir][this.frameOf(d.a)];
      b.drawImage(sprite, Math.round(d.a.x - CHAR_W / 2), Math.round(d.a.y - (animal ? 21 : CHAR_H) + 1));
      if (d.accessory && d.accessory !== "none") drawAccessory(b, d.a.x, d.a.y, d.a.dir, d.accessory);
    }
    if (this.art?.foreground) b.drawImage(this.art.foreground, 0, 0);

    if (this.sceneId === "street" && this.deliveryPoint) {
      const x = Math.round(this.deliveryPoint.x * STREET_W);
      const y = Math.round(this.deliveryPoint.y * STREET_H);
      b.fillStyle = "#3b2a20";
      b.fillRect(x, y - 14, 1, 14);
      b.fillStyle = "#e5574a";
      b.fillRect(x + 1, y - 14, 7, 5);
      b.fillRect(x + 1, y - 9, 4, 2);
    }

    // 放大到顯示畫布
    const d = this.dctx;
    const k = this.scale * this.dpr;
    const textWidth = this.display.width / this.dpr;
    const textHeight = this.display.height / this.dpr;
    const labels: MapLabel[] = [];
    const PIXEL = '"Cubic 11","Noto Sans TC",sans-serif';
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.imageSmoothingEnabled = false;
    d.drawImage(this.buffer, 0, 0, v.w * k, v.h * k);
    d.setTransform(1, 0, 0, 1, -cam.x * k, -cam.y * k); // 文字以「世界座標 × k」繪製

    if (this.sceneId === "street") {
      d.font = `${10 * k}px sans-serif`;
      d.textAlign = "center";
      for (const item of this.items) {
        const bob = Math.sin(performance.now() / 350 + item.x) * 1.5;
        d.fillStyle = "#fff3bf";
        d.beginPath(); d.ellipse(item.x * k, (item.y + 1) * k, 5 * k, 2 * k, 0, 0, Math.PI * 2); d.fill();
        d.fillText(item.icon, item.x * k, (item.y - 4 + bob) * k);
      }
    }

    // 高解析度文字：招牌、名牌、泡泡
    d.textAlign = "center";
    d.textBaseline = "middle";
    for (const [index, sign] of (this.art?.signs ?? []).entries()) {
      labels.push({ id: `sign-${index}`, text: sign.text,
        x: (sign.x + sign.w / 2 - cam.x) * this.scale, y: (sign.y - cam.y) * this.scale,
        worldSize: sign.size * this.scale, width: Math.max(sign.w * this.scale, Math.min(160, textWidth * .3)),
        kind: sign.kind ?? 'store', color: sign.color });
    }
    if (this.sceneId === "street" && this.deliveryPoint) {
      labels.push({ id: 'delivery', text: '送餐地點',
        x: (this.deliveryPoint.x * STREET_W - cam.x) * this.scale,
        y: (this.deliveryPoint.y * STREET_H - 21 - cam.y) * this.scale,
        worldSize: 8 * this.scale, width: 140, kind: 'info', color: '#3b2a20', background: '#fffaf0' });
    }
    const FONT = `"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    // 陳列台商品：前板兩行（品名、價格），字太長先縮小、再截斷
    for (const p of this.art?.products ?? []) {
      const meal = this.meals.find((m) => m.id === p.mealId);
      if (!meal) continue;
      const maxW = (p.w - 2) * k;
      // 角色站在前板前面時（身體擋住文字），文字淡化，避免字疊在人身上
      const labelTop = p.labelY - 4;
      const labelBottom = p.labelY + PRODUCT_PRICE_DY + 4;
      const covered = draws.some(
        (dr) =>
          // 角色身體實際寬約 12px（sprite 兩側留白），只淡化真的被擋住的那一道
          Math.abs(dr.a.x - p.x) < p.w / 2 + 6 && dr.a.y - CHAR_H < labelBottom && dr.a.y > labelTop,
      );
      d.globalAlpha = covered ? 0.18 : 1;
      const name = fitText(d, meal.name, maxW, 5 * k, 3.6 * k, `700`, FONT);
      d.font = name.font;
      d.fillStyle = "#fff4dc";
      d.fillText(name.text, p.x * k, p.labelY * k);
      d.font = `800 ${4.6 * k}px ${FONT}`;
      d.fillStyle = "#ffd36b";
      d.fillText(`$${meal.priceTwd}`, p.x * k, (p.labelY + PRODUCT_PRICE_DY) * k, maxW);
    }
    d.globalAlpha = 1;
    // 站在前面的商品：上方顯示完整名稱與價格
    if (this.nearProduct) {
      const p = this.nearProduct;
      const meal = this.meals.find((m) => m.id === p.mealId);
      if (meal) {
        labels.push({ id: 'product-info', text: `${meal.name}  NT$${meal.priceTwd}`,
          x: (p.x - cam.x) * this.scale, y: (p.y - 20 - cam.y) * this.scale,
          worldSize: 6 * this.scale, width: textWidth - 16, kind: 'info', color: '#3b2a20', background: '#fffdf6' });
      }
    }
    for (const p of this.art?.products ?? []) {
      const q = this.myQty.get(p.mealId);
      if (!q) continue;
      const bx = (p.x + p.size / 2) * k;
      const by = p.y * k;
      d.fillStyle = "#e5574a";
      roundRect(d, bx - 5 * k, by - 3 * k, 10 * k, 7 * k, 3 * k);
      d.font = `800 ${5 * k}px "PingFang TC","Noto Sans TC",sans-serif`;
      d.fillStyle = "#fff";
      d.fillText(`×${q}`, bx, by + 0.6 * k);
    }
    const now = performance.now();
    for (const dr of draws) {
      const friendNear = dr.friend?.id === this.nearFriend?.id;
      if (dr.friend && !friendNear && !this.bubbles.has(dr.id)) continue;
      const x = (dr.a.x - cam.x) * this.scale;
      labels.push({ id: `name-${dr.id}`,
        text: `${dr.badge ? ACHIEVEMENTS.find((a) => a.id === dr.badge)?.icon ?? "" : ""}${dr.name}`,
        x, y: (dr.a.y + 7 - cam.y) * this.scale, width: 160, worldSize: 5 * this.scale,
        kind: 'name', priority: dr.self ? 105 : 100, color: '#fff', background: dr.self ? '#d9483eee' : '#3b2a20ee' });
      const bubble = this.bubbles.get(dr.id);
      if (bubble && bubble.until > now) {
        labels.push({ id: `bubble-${dr.id}`, text: bubble.text, x,
          y: (dr.a.y - CHAR_H - 12 - cam.y) * this.scale, width: Math.min(260, textWidth - 16),
          worldSize: 6 * this.scale, kind: 'bubble', color: '#3b2a20', background: '#fffdf6' });
      } else if (bubble) this.bubbles.delete(dr.id);
    }
    // Place all map labels together so shop signs, names and bubbles cannot overlap.
    const placed = layoutMapLabels(labels, textWidth, textHeight, (text, size, kind) => {
      d.font = `400 ${size * this.dpr}px ${kind === "info" ? FONT : PIXEL}`;
      return d.measureText(text).width / this.dpr;
    });
    d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const label of placed) {
      const x = label.left + label.boxWidth / 2;
      const y = label.top + label.boxHeight / 2;
      d.font = `400 ${label.fontSize}px ${label.kind === "info" ? FONT : PIXEL}`;
      if (label.background) {
        d.fillStyle = label.background;
        roundRect(d, label.left, label.top, label.boxWidth, label.boxHeight, 3);
      } else {
        d.lineWidth = 3; d.strokeStyle = '#fffaf0';
        d.strokeText(label.text, x, y);
      }
      d.fillStyle = label.color;
      d.fillText(label.text, x, y);
    }

    d.setTransform(1, 0, 0, 1, 0, 0);
    if (this.fade > 0) {
      d.fillStyle = `rgba(30, 20, 14, ${this.fade})`;
      d.fillRect(0, 0, this.display.width, this.display.height);
    }
  }

  private tick = (t: number) => {
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  };

  /** 門口提示按鈕要定位在角色上方（CSS 像素）。 */
  doorAnchor(): { x: number; y: number } | null {
    if (!this.nearDoor) return null;
    const cam = this.camera();
    return { x: (this.me.x - cam.x) * this.scale, y: (this.me.y - CHAR_H - 2 - cam.y) * this.scale };
  }
}

function roundRect(d: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  d.beginPath();
  d.roundRect(x, y, w, h, r);
  d.fill();
}

export type { Rect };

/** 不在本團的店面換成可進店的 Store；門口位置與本團店家一樣由店面格決定。 */
export function streetStoreAsStore(s: StreetStore): Store {
  return { id: s.id, name: s.name, sceneId: `shop:${s.id}`, door: lotDoor(s.lotIndex), interiorAssetKey: `interior-${s.styleKey}`,
    styleKey: s.styleKey, lotIndex: s.lotIndex };
}

function catalogSig(stores: Store[], meals: Meal[], streetStores: StreetStore[]) {
  return [
    ...stores.map((s) => `${s.id}:${s.lotIndex}:${s.styleKey}:${s.name}:${s.resting ? 1 : 0}`),
    ...streetStores.map((s) => `street:${s.id}:${s.lotIndex}:${s.styleKey}:${s.name}`),
    ...[...meals, ...streetStores.flatMap((s) => s.meals ?? [])].map((m) => `${m.id}:${m.name}:${m.priceTwd}:${m.imageAssetKey}`),
  ].join("|");
}

/** 選中的商品：描邊框加上會上下跳的小箭頭。 */
function drawProductHighlight(b: CanvasRenderingContext2D, p: ProductSlot, t: number) {
  const x0 = Math.round(p.x - p.size / 2) - 2;
  const y0 = p.y - 2;
  const s = p.size + 4;
  b.fillStyle = "#ffe27a";
  b.fillRect(x0, y0, s, 1);
  b.fillRect(x0, y0 + s - 1, s, 1);
  b.fillRect(x0, y0, 1, s);
  b.fillRect(x0 + s - 1, y0, 1, s);
  const bob = Math.floor(t / 250) % 2;
  const ax = Math.round(p.x);
  const ay = y0 - 6 + bob;
  b.fillStyle = "#3b2a20";
  b.fillRect(ax - 3, ay - 1, 7, 1);
  b.fillStyle = "#ffe27a";
  for (let i = 0; i < 3; i++) b.fillRect(ax - 2 + i, ay + i, 5 - i * 2, 1);
}

/** 在 maxW 內放下文字：先從 size 往下縮到 minSize，仍放不下就截斷加「…」。 */
function fitText(d: CanvasRenderingContext2D, text: string, maxW: number, size: number, minSize: number, weight: string, family: string) {
  for (let s = size; s >= minSize; s -= 0.25 * (size / 5)) {
    d.font = `${weight} ${s}px ${family}`;
    if (d.measureText(text).width <= maxW) return { text, font: d.font };
  }
  d.font = `${weight} ${minSize}px ${family}`;
  const chars = [...text];
  while (chars.length > 1 && d.measureText(chars.join("") + "…").width > maxW) chars.pop();
  return { text: chars.join("") + "…", font: d.font };
}

function drawAccessory(c: CanvasRenderingContext2D, x: number, y: number, dir: Direction, kind: Accessory) {
  x = Math.round(x); y = Math.round(y) - CHAR_H + 3;
  if (kind === "cap") {
    c.fillStyle = "#314e70"; c.fillRect(x - 7, y - 1, 14, 4);
    c.fillStyle = "#72bad0"; c.fillRect(x - 6, y - 3, 12, 3);
    c.fillStyle = "#e9d789"; c.fillRect(x + (dir === "left" ? -10 : dir === "right" ? 3 : -8), y + 2, dir === "up" ? 14 : 17, 2);
  } else if (kind === "leaf") {
    c.fillStyle = "#365f37"; c.fillRect(x - 5, y - 2, 11, 3);
    c.fillStyle = "#9bc65c"; c.fillRect(x - 3, y - 5, 7, 3);
    c.fillStyle = "#d6e891"; c.fillRect(x, y - 6, 3, 4);
  } else {
    const side = dir === "left" ? -7 : 6;
    c.fillStyle = "#f4a4b5"; c.fillRect(x + side - 3, y, 7, 3); c.fillRect(x + side - 1, y - 2, 3, 7);
    c.fillStyle = "#ffe29a"; c.fillRect(x + side - 1, y, 3, 3);
  }
}
