import { LunchPartyPanel } from "../journey/LunchPartyPanel";
import { Celebration } from "../journey/Celebration";
import "../journey/journey.css";
import { OrderDeadlineNotice } from "../ordering/OrderDeadlineNotice";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { MoveInput, RoomSnapshot, SceneId } from "../../shared/contracts";
import { describeDelivery, fulfillmentOf } from "../../shared/delivery";
import { AVATARS } from "../../shared/town";
import { roomGateway } from "../adapters/http";
import { errorText, newRequestId } from "../api";
import type { Game } from "../game/game";
import { GameView } from "../game/GameView";
import { deliveryForStore, GroupTotals, MenuPanel, MyOrder, PeopleDetail, RoomOrderStatus } from "../ordering/panels";
import { PaymentCard, PaymentReminder, PaymentSettings } from "../ordering/payments";
import { useRoom } from "../state/useRoom";
import { AvatarPicker, CopyButton, Modal, TopBar, copyText, money } from "../ui";
import { NotFound } from "./NotFound";

export function RoomPage({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const { gate } = room;

  if (gate.kind === "loading") return <Loading />;
  if (gate.kind === "notFound") return <NotFound message="找不到這個團" />;
  if (gate.kind === "closedToGuests") return <NotFound message={`「${gate.info.title}」已收單，只開放原成員查看`} />;
  if (gate.kind === "join") return <JoinGate title={gate.info.title} memberCount={gate.info.memberCount} onJoin={room.join} />;
  if (!room.snap) return <Loading />;
  return <RoomView room={room} />;
}

function Loading() {
  return (
    <div className="page">
      <TopBar />
      <div className="center muted">載入中…</div>
    </div>
  );
}

function JoinGate({ title, memberCount, onJoin }: { title: string; memberCount: number; onJoin(n: string, a: string): Promise<void> }) {
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem("lt-nickname") ?? "";
    } catch {
      return "";
    }
  });
  const [avatar, setAvatar] = useState(AVATARS[1].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      try {
        localStorage.setItem("lt-nickname", nickname);
      } catch {
        /* ignore */
      }
      await onJoin(nickname, avatar);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar />
      <main className="page-body" style={{ maxWidth: 520 }}>
        <form className="panel" onSubmit={submit}>
          <div className="muted">你被邀請加入</div>
          <h2>{title}</h2>
          <div className="muted">已有 {memberCount} 人在團裡</div>
          <label className="field">
            暱稱 <small>1 至 12 個字</small>
            <input type="text" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} required autoFocus />
          </label>
          <AvatarPicker value={avatar} onChange={setAvatar} />
          {error && <div className="banner error">{error}</div>}
          <button className="btn primary big" disabled={busy || !nickname.trim()}>
            {busy ? "加入中…" : "加入午餐小鎮"}
          </button>
        </form>
      </main>
    </div>
  );
}

type Tab = "group" | "mine" | "people";

function RoomView({ room }: { room: ReturnType<typeof useRoom> }) {
  const snap = room.snap!;
  const { conn, pending, feedback, presence, resolving } = room;
  const gameRef = useRef<Game | null>(null);
  const [scene, setScene] = useState<SceneId>("street");
  const [tab, setTab] = useState<Tab>("group");
  const [paymentSettings, setPaymentSettings] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [partyBusy, setPartyBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const seenCelebration = useRef(0);
  const [nearMealId, setNearMealId] = useState<string | null>(null);

  const isOwner = snap.me.role === "owner";
  const closed = snap.room.status === "closed";
  const canEdit = !closed && conn === "online" && !resolving;
  const store = scene.startsWith("shop:") ? snap.catalog.stores.find((s) => s.sceneId === scene) : undefined;
  const online = Math.max(1, presence.players.length);
  const inviteUrl = `${location.origin}/r/${snap.room.id}`;

  useEffect(() => {
    if (!feedback) return;
    setShowFeedback(true);
    const t = setTimeout(() => setShowFeedback(false), 3500);
    return () => clearTimeout(t);
  }, [feedback]);

  useEffect(() => {
    gameRef.current?.setEnabled(!invite && !confirmClose && !paymentSettings && !photoOpen && exportText === null);
  }, [invite, confirmClose, paymentSettings, exportText, photoOpen]);

  useEffect(() => {
    const celebration = snap.lunchParty?.celebration;
    if (!celebration || snap.lunchParty?.readyMemberIds.length !== snap.members.length
      || !celebration.members.some((m) => m.id === snap.me.id)
      || invite || confirmClose || paymentSettings || exportText !== null) return;
    const key = `lunch-town:celebration:${snap.room.id}:${snap.me.id}`;
    let saved = seenCelebration.current;
    try { saved = Math.max(saved, Number(sessionStorage.getItem(key)) || 0); } catch { /* 儲存受限時以目前分頁記憶體判斷。 */ }
    if (celebration.id <= saved) return;
    seenCelebration.current = celebration.id;
    try { sessionStorage.setItem(key, String(celebration.id)); } catch { /* 儲存受限時以目前分頁記憶體判斷。 */ }
    setPhotoOpen(true);
  }, [snap.lunchParty?.celebration?.id, snap.lunchParty?.readyMemberIds.length, snap.members.length, snap.room.id, snap.me.id, invite, confirmClose, paymentSettings, exportText]);

  async function setLunchReady(ready: boolean) {
    if (partyBusy) return;
    setPartyBusy(true);
    try { room.applySnapshot(await roomGateway.setLunchReady(snap.room.id, ready)); }
    catch (e) { room.say("error", errorText(e)); }
    finally { setPartyBusy(false); }
  }

  const onMove = useCallback((m: MoveInput) => roomGateway.move(snap.room.id, m), [snap.room.id]);

  async function paymentAction(action: () => Promise<RoomSnapshot>) {
    setPaymentBusy(true);
    try {
      room.applySnapshot(await action());
      if (isOwner) await room.refreshSummary();
    } catch (e) {
      room.say("error", errorText(e));
    } finally { setPaymentBusy(false); }
  }

  async function doClose() {
    setClosing(true);
    setCloseError("");
    const requestId = newRequestId();
    try {
      let s;
      for (let i = 0; ; i++) {
        try {
          s = await roomGateway.closeRoom(snap.room.id, requestId);
          break;
        } catch (e) {
          if (i < 2) await new Promise((r) => setTimeout(r, 600));
          else throw e;
        }
      }
      room.applySnapshot(s);
      setConfirmClose(false);
      await openExport();
    } catch (e) {
      setCloseError(errorText(e));
    } finally {
      setClosing(false);
    }
  }

  async function openExport() {
    try {
      const t = await roomGateway.exportOrder(snap.room.id);
      setExportText(t);
      setCopyFailed(!(await copyText(t)));
    } catch (e) {
      room.say("error", errorText(e));
    }
  }

  const ordering = { snap, pending, canEdit, change: room.change };
  const deliveryPlans = snap.storeTotals.filter((s) => s.totalQuantity > 0).map((total) => {
    const store = snap.catalog.stores.find((s) => s.id === total.storeId)!;
    return { store, result: deliveryForStore(snap, store) };
  });
  const hasDeliveryWarnings = deliveryPlans.some(({ result }) => result.kind !== "ok" && result.kind !== "no-point");

  return (
    <div className="room">
      <TopBar>
        <span className="sep" />
        <span className="title">{snap.room.title}</span>
        <span className="sep" />
        <span>
          <span className={`dot ${conn}`} />
          {conn === "online" ? `${online} 人在線` : conn === "connecting" ? "連線中…" : "連線中斷"}
        </span>
        {closed && <span className="tag" style={{ background: "var(--ink)", color: "#fff" }}>已收單</span>}
        <span className="spacer" />
        <span className="muted">我是 {snap.me.nickname}{isOwner ? "（揪團者）" : ""}</span>
        <button className="btn green" onClick={() => setInvite(true)}>
          邀請朋友
        </button>
      </TopBar>

      <div className={`room-main${panelCollapsed ? " panel-collapsed" : ""}`}>
        <GameView
          snap={snap}
          presence={presence}
          online={conn === "online"}
          canOrder={canEdit}
          controlsEnabled={!invite && !confirmClose && !paymentSettings && !photoOpen && exportText === null}
          onPickProduct={(id) => room.change(id, 1)}
          onNearProduct={setNearMealId}
          onReady={(g) => (gameRef.current = g)}
          onSceneChange={setScene}
          onMove={onMove}
        />

        <button type="button" className="mobile-panel-toggle" aria-expanded={!panelCollapsed} aria-controls="room-order-panel"
          onClick={() => setPanelCollapsed(!panelCollapsed)}>
          {panelCollapsed ? "▲ 展開菜單與訂單" : "▼ 收合菜單，放大街景"} · {snap.lunchParty?.readyMemberIds.length ?? 0}／{snap.members.length} 人選好
        </button>
        <aside className="side" id="room-order-panel">
          <LunchPartyPanel snap={snap} disabled={!canEdit || Object.keys(pending).length > 0} busy={partyBusy}
            onReady={(ready) => void setLunchReady(ready)} onPhoto={() => setPhotoOpen(true)} />
          {conn === "offline" && <div className="banner error">連線中斷，暫停修改；恢復後會自動同步</div>}
          {resolving && <div className="banner info">正在確認先前未完成的操作…</div>}
          {closed && <div className="banner info">已收單，訂單已鎖定，不能再修改</div>}
          {!store && !isOwner && <PaymentCard snap={snap} busy={paymentBusy || conn !== "online"}
            onReport={() => void paymentAction(() => roomGateway.reportPayment(snap.room.id))} />}
          {closed && !store && <RoomOrderStatus snap={snap} />}
          {showFeedback && feedback && (
            <div className={`banner ${feedback.kind}`} role="status">
              {feedback.kind === "ok" ? "✔" : feedback.kind === "error" ? "!" : "i"} {feedback.text}
            </div>
          )}

          {store ? (
            <>
              <MenuPanel {...ordering} store={store} focusMealId={nearMealId} />
              <MyOrder {...ordering} />
            </>
          ) : (
            <>
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === "group"} onClick={() => setTab("group")}>
                  揪團訂單
                </button>
                <button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
                  我的訂單 {snap.myTotalQuantity > 0 ? `(${snap.myTotalQuantity})` : ""}
                </button>
                {isOwner && (
                  <button role="tab" aria-selected={tab === "people"} onClick={() => setTab("people")}>
                    每人明細
                  </button>
                )}
              </div>
              {tab === "group" && <GroupTotals snap={snap} />}
              {tab === "mine" && <MyOrder {...ordering} />}
              {tab === "people" && isOwner && <PeopleDetail snap={snap} summary={room.summary}
                paymentBusy={paymentBusy || conn !== "online"}
                onConfirm={(memberId, confirmed) => void paymentAction(() =>
                  roomGateway.confirmPayment(snap.room.id, memberId, confirmed))} />}

              {isOwner && <div className="card stack" aria-label="收款管理">
                <button className="btn" disabled={paymentBusy || conn !== "online"}
                  onClick={() => setPaymentSettings(true)}>
                  {snap.payment?.sentAt != null ? "修改收款設定" : "收款設定"}
                </button>
                {snap.payment?.sentAt != null && <div className="muted">
                  已於 {new Date(snap.payment.sentAt).toLocaleTimeString("zh-TW", {
                    hour: "2-digit", minute: "2-digit", hour12: false,
                  })} 傳送
                </div>}
                {closed && snap.payment && snap.payment.sentAt === null &&
                  <button className="btn primary big payment-send" disabled={paymentBusy || conn !== "online"}
                    onClick={() => void paymentAction(() => roomGateway.sendPaymentInfo(snap.room.id))}>
                    傳送收款資訊給團員
                  </button>}
                <PaymentReminder snap={snap} busy={paymentBusy || conn !== "online"}
                  unpaidCount={room.summary?.people.filter((p) => p.paymentStatus === "unpaid").length ?? 0}
                  onRemind={() => void paymentAction(() => roomGateway.remindUnpaid(snap.room.id))} />
              </div>}

              {isOwner &&
                (closed ? (
                  <button className="btn primary big" onClick={openExport}>
                    查看並複製訂購明細
                  </button>
                ) : (
                  <button className="btn primary big" disabled={conn !== "online" || snap.totalQuantity === 0} onClick={() => setConfirmClose(true)}>
                    收單並複製明細
                  </button>
                ))}

              <div className="stack">
                <strong>前往店家</strong>
                <div className="goto-list">
                  {snap.catalog.stores.map((s) => (
                    <button key={s.id} className="btn small" onClick={() => gameRef.current?.enterStore(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {photoOpen && snap.lunchParty?.celebration && <Celebration key={snap.lunchParty.celebration.id} celebration={snap.lunchParty.celebration} onClose={() => setPhotoOpen(false)} />}

      {invite && (
        <Modal title="邀請朋友加入" onClose={() => setInvite(false)}>
          <p style={{ margin: 0 }}>把這個網址傳到群組，大家打開就能加入「{snap.room.title}」。</p>
          <input type="text" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <CopyButton text={inviteUrl} label="複製網址" />
            <button className="btn ghost" onClick={() => setInvite(false)}>
              關閉
            </button>
          </div>
        </Modal>
      )}

      {confirmClose && (
        <Modal title="確定收單？" onClose={() => !closing && setConfirmClose(false)}>
          <p style={{ margin: 0 }}>
            收單後會<strong>直接把訂單送到各店家</strong>，大家將無法再修改。
            目前共 {snap.totalQuantity} 份、{money(snap.totalTwd)}。
          </p>
          <div className="stack">
            {deliveryPlans.map(({ store, result }) => <div key={store.id}
              className={result.kind !== "ok" && result.kind !== "no-point" ? "banner info delivery-warning" : ""}>
              <strong>{store.name} · {fulfillmentOf(result) === "delivery" ? "外送" : "自取"}</strong>
              <small>{describeDelivery(result)}</small>
            </div>)}
          </div>
          <OrderDeadlineNotice snap={snap} />
          {closeError && <div className="banner error">{closeError}</div>}
          <div className="row">
            <button className="btn primary delivery-close" disabled={closing} onClick={doClose}>
              {closing ? "收單中…" : hasDeliveryWarnings ? "收單並送出（未達標的店改自取）" : "確定收單"}
            </button>
            <button className="btn ghost" disabled={closing} onClick={() => setConfirmClose(false)}>
              {hasDeliveryWarnings ? "回去加點" : "再等等"}
            </button>
          </div>
        </Modal>
      )}

      {paymentSettings && <PaymentSettings info={snap.payment?.info}
        onClose={() => setPaymentSettings(false)} onSave={async (info) => {
          room.applySnapshot(await roomGateway.setPaymentInfo(snap.room.id, info));
        }} />}

      {exportText !== null && (
        <Modal title="訂單已送出" onClose={() => setExportText(null)}>
          <p>已送到 {snap.storeOrders?.length ?? 0} 家店家，可在下方看到店家回覆</p>
          <div className={`banner ${copyFailed ? "info" : "ok"}`}>
            {copyFailed ? "無法自動複製，請全選下方文字手動複製" : "已複製到剪貼簿，可保留作為備份"}
          </div>
          <RoomOrderStatus snap={snap} />
          <textarea className="export-box" readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <CopyButton text={exportText} label="再複製一次" />
            <button className="btn ghost" onClick={() => setExportText(null)}>
              關閉
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
