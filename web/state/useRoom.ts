import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerSummary, PresenceSnapshot, RoomPublicInfo, RoomSnapshot } from "../../shared/contracts";
import { roomGateway as gw } from "../adapters/http";
import { orderStatusLabels } from "../ui";
import { ApiError, errorText, newRequestId } from "../api";
import { lineKeyOf, optionLabel } from "../../shared/meal-options";
import { lineName } from "../../shared/pricing";

export type Conn = "connecting" | "online" | "offline";

/** 一筆點餐明細：餐點 + 選項組合 + 備註（#14）。 */
export interface LineRef {
  mealId: string;
  choiceIds?: string[];
  note?: string;
}

/** 以明細識別鍵（lineKeyOf）存放；沒有選項與備註時就是 mealId，與升級前存的相同。 */
export interface Pending extends LineRef {
  delta: 1 | -1;
  requestId: string;
}

export const pendingKeyOf = (p: LineRef) => lineKeyOf(p.mealId, p.choiceIds ?? [], p.note ?? "");

export interface Feedback {
  kind: "ok" | "error" | "info";
  text: string;
  at: number;
}

type Gate =
  | { kind: "loading" }
  | { kind: "join"; info: RoomPublicInfo }
  | { kind: "notFound" }
  | { kind: "closedToGuests"; info: RoomPublicInfo }
  | { kind: "ready" };

const pendingKey = (roomId: string) => `lt-pending-${roomId}`;
const RETRY_DELAYS = [400, 1200, 2500];

function loadPending(roomId: string): Record<string, Pending> {
  try {
    return JSON.parse(sessionStorage.getItem(pendingKey(roomId)) ?? "{}") as Record<string, Pending>;
  } catch {
    return {};
  }
}
function savePending(roomId: string, p: Record<string, Pending>) {
  try {
    sessionStorage.setItem(pendingKey(roomId), JSON.stringify(p));
  } catch {
    /* 私密模式等 */
  }
}

export function useRoom(roomId: string) {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [summary, setSummary] = useState<OwnerSummary | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [pending, setPending] = useState<Record<string, Pending>>(() => loadPending(roomId));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [presence, setPresence] = useState<PresenceSnapshot>({ roomId, players: [] });
  /** 重新整理後、待確認的請求尚未釐清前，暫停新的修改。 */
  const [resolving, setResolving] = useState(() => Object.keys(loadPending(roomId)).length > 0);

  const previousSnapshot = useRef<RoomSnapshot | null>(null);
  const revRef = useRef(0);
  const summaryRevRef = useRef(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const say = useCallback((kind: Feedback["kind"], text: string) => setFeedback({ kind, text, at: Date.now() }), []);

  const applySnapshot = useCallback((s: RoomSnapshot) => {
    if (s.room.revision < revRef.current) return; // 丟棄舊版本
    const previous = previousSnapshot.current;
    const updates = (s.storeOrders ?? []).filter((order) => {
      const old = previous?.storeOrders?.find((o) => o.storeId === order.storeId);
      return old && old.status !== order.status;
    });
    if (updates.length) say("info", updates.map((o) => o.status === "rejected"
      ? `${o.storeName} 拒單：${o.rejectReason}` : `${o.storeName} ${orderStatusLabels[o.status]}`).join("；"));
    if (previous && s.me.role !== "owner" && !previous.payment && s.payment) {
      say("info", `${s.payment.ownerNickname}傳來收款資訊`);
    }
    if (previous && previous.myPayment?.status !== "confirmed" && s.myPayment?.status === "confirmed") {
      say("info", "團主已確認收到你的付款");
    }
    previousSnapshot.current = s;
    revRef.current = s.room.revision;
    setSnap(s);
  }, [say]);

  const refreshSummary = useCallback(async () => {
    try {
      const s = await gw.getOwnerSummary(roomId);
      if (s.revision < summaryRevRef.current) return;
      summaryRevRef.current = s.revision;
      setSummary(s);
    } catch {
      /* 非 owner 或暫時失敗，下次變更再試 */
    }
  }, [roomId]);

  const refresh = useCallback(async () => {
    try {
      const s = await gw.getSnapshot(roomId);
      applySnapshot(s);
      if (s.me.role === "owner") void refreshSummary();
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.code === "SESSION_REQUIRED") setGate({ kind: "loading" });
      return null;
    }
  }, [roomId, applySnapshot, refreshSummary]);

  const setPendingFor = useCallback(
    (key: string, p: Pending | null) => {
      setPending((prev) => {
        const next = { ...prev };
        if (p) next[key] = p;
        else delete next[key];
        savePending(roomId, next);
        pendingRef.current = next;
        return next;
      });
    },
    [roomId],
  );

  /** 送出一次點餐變更；逾時或忙碌以同一 requestId 重試，絕不換新 ID 再加一次。 */
  const send = useCallback(
    async (p: Pending, mealName: string, silent = false): Promise<void> => {
      for (let attempt = 0; ; attempt++) {
        try {
          // 沒有選項與備註時不帶這兩個欄位，維持升級前的請求格式與去重 digest。
          const ack = await gw.changeQuantity(roomId, {
            mealId: p.mealId,
            delta: p.delta,
            requestId: p.requestId,
            ...(p.choiceIds?.length ? { choiceIds: p.choiceIds } : {}),
            ...(p.note ? { note: p.note } : {}),
          });
          setPendingFor(pendingKeyOf(p), null);
          if (!silent) {
            say("ok", p.delta === 1 ? `已加入：${mealName} × ${ack.quantity}` : ack.quantity === 0 ? `已移除：${mealName}` : `已減少：${mealName} × ${ack.quantity}`);
          }
          await refresh();
          return;
        } catch (e) {
          const err = e as ApiError;
          if (err instanceof ApiError && err.retryable && attempt < RETRY_DELAYS.length) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
            continue;
          }
          if (err instanceof ApiError && err.retryable) {
            // 結果仍未知：保留 pending，等重連後以同一 ID 釐清
            say("error", "網路不穩，這筆操作待確認，恢復連線後會自動確認");
            return;
          }
          setPendingFor(pendingKeyOf(p), null);
          if (err instanceof ApiError && err.code === "ROOM_CLOSED") say("info", "已收單，不能再修改");
          else say("error", `${mealName}：${errorText(e)}`);
          await refresh();
          return;
        }
      }
    },
    [roomId, refresh, say, setPendingFor],
  );

  /** 把重新整理或斷線前沒確認的請求，用原 requestId 重送以釐清結果。 */
  const resolvePending = useCallback(async () => {
    const list = Object.values(pendingRef.current);
    if (list.length === 0) {
      setResolving(false);
      await refresh();
      return;
    }
    setResolving(true);
    await Promise.all(list.map((p) => send(p, "", true)));
    setResolving(false);
    await refresh();
  }, [send, refresh]);

  const change = useCallback(
    (target: string | LineRef, delta: 1 | -1) => {
      if (!snap || snap.room.status !== "open" || conn !== "online" || resolving) return;
      const line: LineRef = typeof target === "string" ? { mealId: target } : target;
      const key = pendingKeyOf(line);
      if (pendingRef.current[key]) return; // 同一筆明細一次只允許一個待確認操作
      const meal = snap.catalog.meals.find((m) => m.id === line.mealId);
      // 遊戲畫面直接點餐不會帶選項；有必選選項時請使用者到菜單選。
      const required = meal?.options?.find((g) => g.min > 0);
      if (delta === 1 && required && !line.choiceIds?.length) {
        say("info", `${meal!.name}需要先選「${required.name}」，請在菜單上選擇`);
        return;
      }
      const p: Pending = { ...line, delta, requestId: newRequestId() };
      setPendingFor(key, p);
      void send(p, meal ? lineName(meal.name, optionLabel(meal.options, line.choiceIds)) : "");
    },
    [snap, conn, resolving, send, setPendingFor],
  );

  // 進入：先試 snapshot，沒有身分再顯示加入頁
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await gw.getSnapshot(roomId);
        if (!alive) return;
        applySnapshot(s);
        setGate({ kind: "ready" });
        if (s.me.role === "owner") void refreshSummary();
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.code === "SESSION_REQUIRED") {
          try {
            const info = await gw.getPublicInfo(roomId);
            setGate(info.status === "closed" ? { kind: "closedToGuests", info } : { kind: "join", info });
          } catch {
            setGate({ kind: "notFound" });
          }
        } else if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
          setGate({ kind: "notFound" });
        } else {
          setGate({ kind: "notFound" });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomId, applySnapshot, refreshSummary]);

  const join = useCallback(
    async (nickname: string, avatarId: string) => {
      try {
        const s = await gw.joinRoom(roomId, { nickname, avatarId });
        applySnapshot(s);
        setGate({ kind: "ready" });
      } catch (e) {
        if (e instanceof ApiError && e.code === "ROOM_CLOSED") {
          const info = await gw.getPublicInfo(roomId);
          setGate({ kind: "closedToGuests", info });
          return;
        }
        throw e;
      }
    },
    [roomId, applySnapshot],
  );

  // 即時連線
  const ready = gate.kind === "ready";
  useEffect(() => {
    if (!ready) return;
    setConn("connecting");
    const unsub = gw.subscribe(roomId, {
      onChanged(e) {
        if (e.revision > revRef.current) void refresh();
      },
      onPresence(e) {
        setPresence(e);
      },
      onReconnect() {
        setConn("online");
        void resolvePending();
      },
      onDisconnect() {
        setConn("offline");
      },
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, [ready, roomId, refresh, resolvePending]);

  return {
    gate,
    snap,
    summary,
    conn,
    setConn,
    pending,
    resolving,
    feedback,
    presence,
    join,
    change,
    refresh,
    say,
    applySnapshot,
    refreshSummary,
  };
}
