import { useEffect, useRef, useState } from "react";
import type { MoveInput, PresenceSnapshot, RoomSnapshot, SceneId, Store } from "../../shared/contracts";
import { roomGateway } from "../adapters/http";
import { Game } from "./game";
import { VirtualJoystick } from "./VirtualJoystick";

interface Props {
  snap: RoomSnapshot;
  presence: PresenceSnapshot;
  online: boolean;
  /** 目前能否點餐（未收單、已連線、無待確認）；只影響提示文字，實際阻擋在 change()。 */
  canOrder: boolean;
  controlsEnabled?: boolean;
  onPickProduct(mealId: string): void;
  onNearProduct(mealId: string | null): void;
  onReady(game: Game): void;
  onSceneChange(sceneId: SceneId): void;
  onMove(input: MoveInput): void;
}

export function GameView({ snap, presence, online, canOrder, controlsEnabled = true, onPickProduct, onNearProduct, onReady, onSceneChange, onMove }: Props) {
  const tapStart = useRef<{ id: number; x: number; y: number; at: number; scene: SceneId } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [nearDoor, setNearDoor] = useState<Store | null>(null);
  const [scene, setScene] = useState<SceneId>("street");
  const [nearMealId, setNearMealId] = useState<string | null>(null);
  const cbRef = useRef({ onSceneChange, onMove, onPickProduct, onNearProduct });
  cbRef.current = { onSceneChange, onMove, onPickProduct, onNearProduct };

  useEffect(() => {
    const game = new Game(canvasRef.current!, {
      onSceneChange: (s) => {
        setScene(s);
        cbRef.current.onSceneChange(s);
      },
      onNearDoor: setNearDoor,
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
    const offBubble = roomGateway.onBubble((b) => game.showBubble(b.memberId, b.text));
    return () => {
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
    g.setCatalog(snap.catalog.stores, snap.catalog.meals);
    g.setMyQuantities(new Map(snap.myItems.map((i) => [i.mealId, i.quantity])));
  }, [snap]);

  useEffect(() => {
    gameRef.current?.setPresence(presence.players);
  }, [presence]);

  useEffect(() => {
    if (online) gameRef.current?.announce();
  }, [online]);

  const inShop = scene !== "street";
  const nearMeal = inShop && nearMealId ? snap.catalog.meals.find((m) => m.id === nearMealId) : undefined;

  return (
    <div className="stage" ref={wrapRef}>
      <canvas ref={canvasRef} className="pixel game-canvas" aria-label="午餐小鎮街景，可用方向鍵、WASD 或觸控搖桿移動；店內餐點可直接點選"
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0 || !controlsEnabled) return;
          tapStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), scene };
        }}
        onPointerMove={(e) => {
          const start = tapStart.current;
          if (start && start.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) tapStart.current = null;
        }}
        onPointerCancel={() => { tapStart.current = null; }}
        onPointerLeave={() => { tapStart.current = null; }}
        onPointerUp={(e) => {
          const start = tapStart.current; tapStart.current = null;
          if (!start || start.id !== e.pointerId || start.scene !== scene || !canOrder || !controlsEnabled
            || performance.now() - start.at > 600 || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return;
          const id = gameRef.current?.productAt(e.clientX, e.clientY);
          if (id) onPickProduct(id);
        }} />
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
      {nearMeal && (
        <button
          className="btn primary stage-action"
          disabled={!canOrder}
          onClick={() => onPickProduct(nearMeal.id)}
        >
          {canOrder ? <><span className="keyboard-label">按 Enter </span><span className="touch-label">點一下</span>加一份「{nearMeal.name}」NT${nearMeal.priceTwd}</> : `「${nearMeal.name}」目前不能點餐`}
        </button>
      )}
      <VirtualJoystick disabled={!controlsEnabled} scene={scene} onMove={(x, y) => gameRef.current?.setTouchInput(x, y)} />
      <div className="touch-hint">{inShop ? "點餐點圖案 ＋1，也可展開菜單" : "拖動搖桿逛街，或在面板選店家"}</div>
      <div className="hint">{inShop ? "走到陳列台的商品前按 Enter 加一份・踩出口地墊或按 Esc 回街上" : "方向鍵／WASD 移動・走進店門就能進店"}</div>
    </div>
  );
}
