import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, PresenceSnapshot, RoomSnapshot, SceneId } from "../../shared/contracts";
import { AVATAR_IDS } from "../../shared/town";
import { request } from "../api";
import { GameView } from "../game/GameView";
import type { Game } from "../game/game";
import { link, navigate } from "../router";
import { MealImg, money, TopBar } from "../ui";

const NO_PRESENCE: PresenceSnapshot = { roomId: "walk", players: [] };

/** 散步模式（#44）：不開團也能在小鎮走動、進店看菜單；單人唯讀，入口一律導回開團。 */
export function TownWalk() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState(false);
  const [scene, setScene] = useState<SceneId>("street");
  const [nearMealId, setNearMealId] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    request<Catalog>("GET", "/api/town/catalog").then(setCatalog).catch(() => setError(true));
  }, []);

  const snap = useMemo<RoomSnapshot | null>(() => {
    if (!catalog) return null;
    // 以日期當房號：小物與村民每天換一批，跟團內一樣是「今日」收藏。
    const roomId = `walk-${new Date().toISOString().slice(0, 10)}`;
    const avatar = readLocal("lt-avatar");
    const me = {
      id: "walker",
      roomId,
      nickname: readLocal("lt-nickname") || "我",
      avatarId: AVATAR_IDS.includes(avatar) ? avatar : AVATAR_IDS[0],
      role: "participant" as const,
    };
    return {
      socialEnabled: false,
      room: { id: roomId, title: "小鎮散步", status: "open", catalogVersion: catalog.catalogVersion, revision: 0 },
      me,
      members: [me],
      catalog,
      myItems: [],
      myTotalTwd: 0,
      myTotalQuantity: 0,
      storeTotals: [],
      totalQuantity: 0,
      totalTwd: 0,
    };
  }, [catalog]);

  const store = snap?.catalog.stores.find((s) => s.sceneId === scene);
  const startRoom = (storeId?: string) => navigate(storeId ? `/?from=${encodeURIComponent(storeId)}` : "/");

  return (
    <div className="room">
      <TopBar>
        <span className="sep" />
        <span className="title">小鎮散步</span>
        <span className="tag">只能逛，不能點餐</span>
        <span className="spacer" />
        <a className="btn green" {...link("/")}>我要開團</a>
      </TopBar>

      {!snap ? (
        <main className="page-body">
          <div className={`banner ${error ? "error" : "info"}`}>{error ? "小鎮暫時進不去，請稍後再試。" : "正在走進小鎮…"}</div>
        </main>
      ) : (
        <div className={`room-main${panelCollapsed ? " panel-collapsed" : ""}`}>
          <GameView
            snap={snap}
            presence={NO_PRESENCE}
            online={false}
            canOrder={false}
            solo
            onPickProduct={(mealId) => startRoom(snap.catalog.meals.find((m) => m.id === mealId)?.storeId)}
            onNearProduct={setNearMealId}
            onReady={(g) => (gameRef.current = g)}
            onSceneChange={setScene}
            onMove={() => {}}
          />

          <button type="button" className="mobile-panel-toggle" aria-expanded={!panelCollapsed} aria-controls="walk-panel"
            onClick={() => setPanelCollapsed(!panelCollapsed)}>
            {panelCollapsed ? "▲ 展開菜單" : "▼ 收合菜單，放大街景"}
          </button>
          <aside className="side" id="walk-panel">
            <div className="banner info">散步模式：可以隨意逛店看菜單；想點餐就開一團，把網址丟到群組。</div>
            {store ? (
              <section className="stack" aria-label={`${store.name} 菜單`}>
                <h2>{store.name}</h2>
                {store.resting && <div className="banner info">這家目前休息中，現在開團不會包含它。</div>}
                <div className="menu">
                  {snap.catalog.meals.filter((m) => m.storeId === store.id).map((m) => (
                    <div key={m.id} className={`meal-row${m.id === nearMealId ? " focused" : ""}`}>
                      <MealImg assetKey={m.imageAssetKey} alt={m.name} />
                      <div>
                        <div className="meal-name">{m.name}</div>
                        <div className="price">{money(m.priceTwd)}</div>
                        <div>{m.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="side-footer">
                  <button className="btn primary big" disabled={store.resting} onClick={() => startRoom(store.id)}>
                    {store.resting ? "休息中，暫時不能用這家開團" : `用「${store.name}」開團`}
                  </button>
                </div>
              </section>
            ) : (
              <>
                {snap.catalog.stores.length === 0 ? (
                  <div className="banner info">小鎮還沒有店家上架餐點，晚點再來逛。</div>
                ) : (
                  <div className="stack">
                    <strong>前往店家</strong>
                    <div className="goto-list">
                      {snap.catalog.stores.map((s) => (
                        <button key={s.id} className="btn small" onClick={() => gameRef.current?.enterStore(s.id)}>
                          {s.name}{s.resting ? "（休息）" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button className="btn primary big" onClick={() => startRoom()}>逛夠了，回去開團</button>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function readLocal(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
