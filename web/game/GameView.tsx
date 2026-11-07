import { NewcomerQuest } from "../journey/NewcomerQuest";
import { VirtualJoystick } from "./VirtualJoystick";
import { useTouchOrdering } from "./useTouchOrdering";
import "./mobile.css";
import { useEffect, useRef, useState } from "react";
import type { MoveInput, PresenceSnapshot, RoomSnapshot, SceneId, Store } from "../../shared/contracts";
import { roomGateway } from "../adapters/http";
import { Game } from "./game";
import { shopkeeperLine } from "./shopkeeper";
import { ownerCall } from "./owner-calls";
import { EMOTES, type EmoteId } from "../../shared/social";
import { ACHIEVEMENTS, ACCESSORIES, collectibles, readCollection, saveCollection, type AchievementId, type Collection } from "./collection";

interface Props {
  snap: RoomSnapshot;
  presence: PresenceSnapshot;
  online: boolean;
  /** 目前能否點餐（未收單、已連線、無待確認）；只影響提示文字，實際阻擋在 change()。 */
  canOrder: boolean;
  controlsEnabled?: boolean;
  /** 散步模式（#44）：單人唯讀，不訂閱泡泡、不顯示表情與同伴；商品動作改為「用這家開團」。 */
  solo?: boolean;
  onPickProduct(mealId: string): void;
  onNearProduct(mealId: string | null): void;
  onReady(game: Game): void;
  onSceneChange(sceneId: SceneId): void;
  onMove(input: MoveInput): void;
}

export function GameView({ snap, presence, online, canOrder, controlsEnabled = true, solo = false, onPickProduct, onNearProduct, onReady, onSceneChange, onMove }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [nearFriend, setNearFriend] = useState<{ name: string; animal: boolean } | null>(null);
  const [nearClerk, setNearClerk] = useState(false);
  const [lifeEnabled, setLifeEnabled] = useState(() => { try { return localStorage.getItem("lunch-town:life") !== "off"; } catch { return true; } });
  const [social, setSocial] = useState(snap.socialEnabled !== false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [emoteBusy, setEmoteBusy] = useState(false);
  const emoteLock = useRef(false);
  const emoteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [collection, setCollection] = useState(() => readCollection(snap.room.id, snap.me.id));
  const collectionRef = useRef(collection);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const [bagOpen, setBagOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function announce(text: string) {
    setNotice(text); clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3500);
  }
  function updateCollection(next: Collection) {
    collectionRef.current = next; setCollection(next);
    saveCollection(snapRef.current.room.id, snapRef.current.me.id, next);
  }
  function unlock(id: AchievementId) {
    const current = collectionRef.current;
    if (current.achievements.includes(id)) return;
    updateCollection({ ...current, achievements: [...current.achievements, id] });
    const achievement = ACHIEVEMENTS.find((a) => a.id === id)!;
    announce(`${achievement.icon} 成就解鎖：${achievement.name}`);
  }
  async function sendEmote(id: EmoteId) {
    if (emoteLock.current || !online || !social) return;
    emoteLock.current = true; setEmoteBusy(true);
    try {
      const result = await roomGateway.sendEmote(snap.room.id, id);
      gameRef.current?.showBubble(snap.me.id, result.text);
    } catch { announce("表情沒有送出，請稍後再試。"); }
    finally { emoteTimer.current = setTimeout(() => { emoteLock.current = false; setEmoteBusy(false); }, 1100); }
  }
  async function toggleSocial() {
    if (socialBusy) return;
    const previous = social;
    setSocialBusy(true);
    setSocial(!previous);
    gameRef.current?.setSocial(!previous);
    try {
      const result = await roomGateway.setSocial(snap.room.id, !previous);
      setSocial(result.enabled);
      gameRef.current?.setSocial(result.enabled);
      gameRef.current?.announce();
    } catch { setSocial(previous); gameRef.current?.setSocial(previous); announce("社交設定未儲存，請稍後再試。"); }
    finally { setSocialBusy(false); }
  }
  const [nearDoor, setNearDoor] = useState<Store | null>(null);
  const [scene, setScene] = useState<SceneId>("street");
  const [nearMealId, setNearMealId] = useState<string | null>(null);
  useTouchOrdering(canvasRef, gameRef, scene, canOrder && controlsEnabled, onPickProduct);
  const cbRef = useRef({ onSceneChange, onMove, onPickProduct, onNearProduct });
  cbRef.current = { onSceneChange, onMove, onPickProduct, onNearProduct };

  useEffect(() => {
    const game = new Game(canvasRef.current!, {
      onSceneChange: (s) => {
        setScene(s);
        if (s !== "street") unlock("visit");
        cbRef.current.onSceneChange(s);
      },
      onNearDoor: setNearDoor,
      onNearFriend: setNearFriend,
      onPet: () => unlock("friend"),
      onNearClerk: setNearClerk,
      clerkLine: (storeId, talk) => {
        const s = snapRef.current;
        const meals = s.catalog.meals.filter((m) => m.storeId === storeId);
        return shopkeeperLine({
          meals: meals.filter((m) => m.available),
          ordered: s.myItems.flatMap((item) => {
            const meal = meals.find((m) => m.id === item.mealId);
            return meal ? [{ name: meal.name, quantity: item.quantity }] : [];
          }),
          roomClosed: s.room.status === "closed",
          deadlineAt: s.catalog.stores.find((store) => store.id === storeId)?.orderDeadlineAt ?? null,
          solo, talk, now: Date.now(),
        });
      },
      onCollect: (id) => {
        const current = collectionRef.current;
        if (current.items.includes(id)) return;
        updateCollection({ ...current, items: [...current.items, id].slice(-100) });
        announce("✨ 撿到街區小物，已放進背包！");
        unlock("collect");
      },
      onMove: (m) => cbRef.current.onMove(m),
      onNearProduct: (id) => {
        setNearMealId(id);
        cbRef.current.onNearProduct(id);
      },
      onPickProduct: (id) => cbRef.current.onPickProduct(id),
    });
    gameRef.current = game;
    onReady(game);
    (window as unknown as { __lunchGame?: { state(): unknown; products(): unknown } }).__lunchGame = { state: () => game.debugState(), products: () => game.debugProducts() };
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current!;
      game.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(wrapRef.current!);
    const offBubble = solo ? () => {} : roomGateway.onBubble((b) => game.showBubble(b.memberId, b.text));
    return () => {
      clearTimeout(noticeTimer.current); clearTimeout(emoteTimer.current);
      ro.disconnect();
      offBubble();
      game.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.setDeliveryPoint(snap.room.deliveryPoint ?? null);
    g.setSelf(snap.me.id);
    g.setMembers(snap.members);
    g.setCatalog(snap.catalog.stores, snap.catalog.meals, snap.streetStores);
    g.setMyQuantities(new Map(snap.myItems.map((i) => [i.mealId, i.quantity])));
    if (snap.myTotalQuantity > 0) unlock("order");
  }, [snap]);

  useEffect(() => {
    gameRef.current?.setPresence(presence.players);
  }, [presence]);

  // 截止前與收單時由團主角色喊話（散步模式沒有團主）。只畫在各自的畫面上，不經伺服器廣播。
  const ownerCallState = useRef({ wasOpen: snap.room.status === "open", reminded: null as number | null });
  useEffect(() => {
    if (solo) return;
    const check = () => {
      const s = snapRef.current, state = ownerCallState.current;
      const call = ownerCall(s.room, state.wasOpen, state.reminded, Date.now());
      state.wasOpen = s.room.status === "open";
      if (!call) return;
      state.reminded = call.reminded;
      const owner = s.members.find((m) => m.role === "owner");
      if (owner) gameRef.current?.showBubble(owner.id, call.text, 5000);
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [solo, snap.room.status, snap.room.deadlineAt]);

  useEffect(() => {
    if (online) gameRef.current?.announce();
  }, [online]);

  useEffect(() => {
    gameRef.current?.setTownLife(snap.room.id, lifeEnabled);
    try { localStorage.setItem("lunch-town:life", lifeEnabled ? "on" : "off"); } catch { /* 本分頁仍可切換。 */ }
  }, [snap.room.id, lifeEnabled]);
  useEffect(() => {
    gameRef.current?.setSocial(social);
    gameRef.current?.setAppearance(collection.accessory, collection.badge && social ? collection.achievements[0] : undefined);
    gameRef.current?.setCollectibles(collectibles(snap.room.id, snap.me.id).filter((item) => !collection.items.includes(item.id)));
  }, [collection, social, snap.room.id, snap.me.id]);

  const inShop = scene !== "street";
  const nearMeal = inShop && nearMealId ? snap.catalog.meals.find((m) => m.id === nearMealId) : undefined;

  return (
    <div className="stage" ref={wrapRef}>
      <VirtualJoystick disabled={!controlsEnabled} scene={scene} onMove={(x, y) => gameRef.current?.setTouchInput(x, y)} />
      <div className="touch-hint">{inShop ? (solo ? "逛逛陳列台，喜歡就用這家開團" : "點餐點圖案 ＋1，也可展開菜單") : "拖動搖桿逛街，或在面板選店家"}</div>
      <canvas ref={canvasRef} className="pixel" aria-label="午餐小鎮街景，用方向鍵或 WASD 移動角色" />
      <NewcomerQuest achievements={collection.achievements} onGuide={(step) => {
        setBagOpen(false);
        if (step === "friend") { setLifeEnabled(true); gameRef.current?.leaveStore(); }
        else { const store = snap.catalog.stores.find((s) => snap.catalog.meals.some((m) => m.storeId === s.id && m.available));
          if (store) gameRef.current?.enterStore(store.id); }
      }} />
      <div className="town-controls">
        <div className="emote-bar" role="group" aria-label="小鎮表情">
          {!solo && EMOTES.map((emote) => <button key={emote.id} className="emote-btn" title={emote.label}
            aria-label={emote.label} disabled={!online || !social || emoteBusy || socialBusy} onClick={() => void sendEmote(emote.id)}>{emote.icon}</button>)}
          <button className="emote-btn bag-toggle" aria-label="背包與小鎮設定" aria-expanded={bagOpen} onClick={() => setBagOpen(!bagOpen)}>🎒</button>
        </div>
        {bagOpen && <section className="town-bag" aria-label="背包與小鎮設定">
          <div className="bag-heading"><strong>🎒 我的午休收藏</strong><button aria-label="關閉背包" onClick={() => setBagOpen(false)}>×</button></div>
          <p>今日小物 {collection.items.filter((id) => collectibles(snap.room.id, snap.me.id).some((item) => item.id === id)).length} / 5 · 走近發光小物就能撿起</p>
          <div className="bag-items" aria-label="已收集的小物">{collectibles(snap.room.id, snap.me.id).map((item) => <span key={item.id} title={collection.items.includes(item.id) ? "已收集" : "尚未找到"} className={collection.items.includes(item.id) ? "found" : "missing"}>{collection.items.includes(item.id) ? item.icon : "？"}</span>)}</div>
          <strong>換個造型</strong>
          <div className="accessory-list" role="group" aria-label="角色配件">{ACCESSORIES.map((a) => <button key={a.id} aria-pressed={collection.accessory === a.id} onClick={() => updateCollection({ ...collectionRef.current, accessory: a.id })}>{a.icon} {a.label}</button>)}</div>
          <strong>小鎮成就 {collection.achievements.length} / {ACHIEVEMENTS.length}</strong>
          <div className="achievement-list">{ACHIEVEMENTS.map((a) => <div key={a.id} className={collection.achievements.includes(a.id) ? "unlocked" : "locked"} title={a.description}>{a.icon} {a.name}<span>{collection.achievements.includes(a.id) ? "✓" : a.description}</span></div>)}</div>
          <label><input type="checkbox" checked={lifeEnabled} onChange={(e) => setLifeEnabled(e.target.checked)} /> 顯示村民與小動物</label>
          {!solo && <label><input type="checkbox" checked={social} disabled={!online || socialBusy} onChange={() => void toggleSocial()} /> 社交表情與點餐泡泡</label>}
          <label><input type="checkbox" checked={collection.badge} onChange={(e) => updateCollection({ ...collectionRef.current, badge: e.target.checked })} /> 顯示成就徽章</label>
        </section>}
      </div>
      {notice && <div className="town-notice" role="status">{notice}</div>}
      {inShop && social && !solo && <div className="shop-company" aria-live="polite">{(() => {
        const ids = new Set(presence.players.filter((p) => p.sceneId === scene && p.memberId !== snap.me.id).map((p) => p.memberId));
        const names = snap.members.filter((m) => ids.has(m.id)).map((m) => m.nickname);
        return names.length ? `一起逛店：${names.join("、")}` : "還沒有人進來，一起揪朋友吧！";
      })()}</div>}
      {!inShop && !nearDoor && nearFriend && <button className="btn primary friend-interact" onClick={() => gameRef.current?.interact()}>
        {nearFriend.animal ? `♥ 摸摸${nearFriend.name}` : `和${nearFriend.name}聊聊`} · Enter
      </button>}
      {inShop && nearClerk && !nearMeal && <button className="btn primary friend-interact" onClick={() => gameRef.current?.talkToClerk()}>
        和店主聊聊 · Enter
      </button>}
      {inShop && (
        <button className="btn back" onClick={() => gameRef.current?.leaveStore()}>
          ← 返回街道
        </button>
      )}
      {!inShop && nearDoor ? (
        <button
          className="btn primary stage-action"
          onClick={() => gameRef.current?.enterStore(nearDoor.id)}
        >
          <span className="keyboard-label">往門裡走或按 E </span><span className="touch-label">點一下</span>進入「{nearDoor.name}」
        </button>
      ) : null}
      {nearMeal && solo && (
        <button className="btn primary stage-action" onClick={() => onPickProduct(nearMeal.id)}>
          <span className="keyboard-label">按 Enter </span><span className="touch-label">點一下</span>喜歡「{nearMeal.name}」NT${nearMeal.priceTwd}？用這家開團
        </button>
      )}
      {nearMeal && !solo && (
        <button
          className="btn primary stage-action"
          disabled={!canOrder}
          onClick={() => onPickProduct(nearMeal.id)}
        >
          {canOrder ? <><span className="keyboard-label">按 Enter </span><span className="touch-label">點一下</span>加一份「{nearMeal.name}」NT${nearMeal.priceTwd}</> : `「${nearMeal.name}」目前不能點餐`}
        </button>
      )}
      <div className="hint">{inShop ? solo ? "散步模式只能逛，走到商品前按 Enter 用這家開團・櫃檯前可和店主聊天・踩出口地墊或按 Esc 回街上" : "走到陳列台的商品前按 Enter 加一份・櫃檯前可和店主聊天・踩出口地墊或按 Esc 回街上" : solo ? "方向鍵／WASD 移動・Enter 摸摸動物・走進店門看菜單" : "方向鍵／WASD 移動・Enter 摸摸動物・右上角可以揮手"}</div>
    </div>
  );
}
