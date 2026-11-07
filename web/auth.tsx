import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CreatedStoreInvite, SessionInfo, StoreInvite } from "../shared/auth";
import type { TownLot } from "../shared/contracts";
import { request, errorText } from "./api";
import { storeGateway } from "./adapters/http";
import { navigate } from "./router";

const AuthContext = createContext<SessionInfo | null>(null);
export const isSitesBuild = import.meta.env.VITE_SITES === "1";
const RETURN_KEY = "lt-sites-return-path";

export function AuthProvider({ session, children }: { session: SessionInfo; children: ReactNode }) {
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

function safeCurrentPath() {
  const path = `${location.pathname}${location.search}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function rememberReturnPath() {
  try { sessionStorage.setItem(RETURN_KEY, safeCurrentPath()); } catch { /* private mode: Sites keeps current URL */ }
}

function consumeReturnPath() {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
  } catch { return null; }
}

export function AccountControls() {
  const session = useAuth();
  if (!isSitesBuild || !session) return null;
  if (!session.authenticated) {
    return <a className="btn small" href={session.signInPath} target="_top" onClick={rememberReturnPath}>使用 ChatGPT 登入</a>;
  }
  return (
    <div className="row" style={{ marginLeft: "auto", gap: 6 }}>
      {session.admin && <a className="btn small" href="/admin/invites">管理店家邀請</a>}
      <span className="muted" title={session.user?.id}>{session.user?.name || session.user?.email || "已登入"}</span>
      <a className="btn small" href={session.signOutPath} target="_top">登出</a>
    </div>
  );
}

export function SignInCard({ session }: { session: SessionInfo }) {
  return (
    <main className="page-body" style={{ maxWidth: 520 }}>
      <section className="panel">
        <h2>先使用 ChatGPT 登入</h2>
        <p className="muted">午餐小鎮只開放給受邀的內部成員與店家管理者。登入後會回到目前的頁面。</p>
        <a className="btn primary big" href={session.signInPath} target="_top" onClick={rememberReturnPath}>使用 ChatGPT 登入</a>
      </section>
    </main>
  );
}

export function InviteAccept({ session }: { session: SessionInfo }) {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!session.authenticated) return <SignInCard session={session} />;
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const invite = await request<StoreInvite>("POST", "/api/store-invites/accept", { token });
      location.assign(`/shop/${encodeURIComponent(invite.storeId)}`);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }
  return (
    <main className="page-body" style={{ maxWidth: 560 }}>
      <section className="panel">
        <h2>店家管理邀請</h2>
        <p className="muted">此邀請只會授予目前登入的 ChatGPT 帳號管理一家店，不會讓你加入團購內部平台。</p>
        {!token ? <div className="banner error">邀請連結缺少 token。</div> : <button className="btn primary big" onClick={() => void accept()} disabled={busy}>{busy ? "兌換中…" : "接受邀請並進入店家後台"}</button>}
        {error && <div className="banner error">{error}</div>}
      </section>
    </main>
  );
}

export function NotMember({ session }: { session: SessionInfo }) {
  return (
    <main className="page-body" style={{ maxWidth: 600 }}>
      <section className="panel">
        <h2>尚未加入午餐小鎮</h2>
        <p className="muted">請把下面的使用者 ID 交給平台管理員，讓他把你加入內部成員名單；若你是店家，請改用管理員寄給你的邀請連結。</p>
        <label className="field">你的 ChatGPT 使用者 ID
          <input readOnly value={session.user?.id ?? ""} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <a className="btn" href={session.signOutPath} target="_top">換一個 ChatGPT 帳號</a>
      </section>
    </main>
  );
}

export function StoreOnlyHome({ session }: { session: SessionInfo }) {
  return (
    <main className="page-body" style={{ maxWidth: 600 }}>
      <section className="panel">
        <h2>店家管理</h2>
        <p className="muted">你的帳號已受邀管理店家；團購與小鎮街景僅開放內部成員。</p>
        <div className="stack">
          {session.storeIds.map((id) => <a className="btn green" key={id} href={`/shop/${encodeURIComponent(id)}`}>前往店家後台</a>)}
        </div>
      </section>
    </main>
  );
}

export function AdminInvites() {
  const session = useAuth();
  const [town, setTown] = useState<TownLot[]>([]);
  const [storeId, setStoreId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [days, setDays] = useState(7);
  const [invites, setInvites] = useState<StoreInvite[]>([]);
  const [created, setCreated] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [nextTown, nextInvites] = await Promise.all([
      storeGateway.getTown(),
      request<StoreInvite[]>("GET", "/api/store-invites"),
    ]);
    setTown(nextTown);
    setStoreId((current) => current || nextTown.find((lot) => lot.store)?.store?.id || "");
    setInvites(nextInvites);
  }
  useEffect(() => { void refresh().catch((cause) => setError(errorText(cause))); }, []);

  if (!session?.admin) return <NotMember session={session!} />;
  async function create() {
    setBusy(true);
    setError("");
    setCreated("");
    try {
      const invite = await request<CreatedStoreInvite>("POST", "/api/store-invites", { storeId, targetUserId, expiresInDays: days });
      setCreated(`${location.origin}/invite?token=${encodeURIComponent(invite.token)}`);
      setTargetUserId("");
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setError("");
    try {
      await request<{ ok: boolean }>("DELETE", `/api/store-invites/${encodeURIComponent(id)}`);
      await refresh();
    } catch (cause) { setError(errorText(cause)); }
  }
  async function revokeManager(invite: StoreInvite) {
    setError("");
    try {
      await request<{ ok: boolean }>("DELETE", `/api/stores/${encodeURIComponent(invite.storeId)}/managers/${encodeURIComponent(invite.targetUserId)}`);
      await refresh();
    } catch (cause) { setError(errorText(cause)); }
  }
  const stores = town.flatMap((lot) => lot.store ? [lot.store] : []);
  return (
    <main className="page-body" style={{ maxWidth: 780 }}>
      <section className="panel">
        <h2>店家管理邀請</h2>
        <p className="muted">使用者 ID 由店家登入後在畫面取得。邀請 token 只在建立當下顯示一次。</p>
        <label className="field">店家
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
        </label>
        <label className="field">受邀的 ChatGPT 使用者 ID
          <input value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} placeholder="貼上對方提供的使用者 ID" />
        </label>
        <label className="field">有效天數
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[1, 3, 7, 14, 30].map((value) => <option key={value} value={value}>{value} 天</option>)}</select>
        </label>
        <button className="btn primary big" disabled={busy || !storeId || !targetUserId.trim()} onClick={() => void create()}>{busy ? "建立中…" : "建立一次性邀請連結"}</button>
        {created && <label className="field">只顯示這一次的邀請連結<input readOnly value={created} onFocus={(event) => event.currentTarget.select()} /></label>}
        {error && <div className="banner error">{error}</div>}
      </section>
      <section className="panel">
        <h2>邀請紀錄</h2>
        {invites.length === 0 ? <p className="muted">目前沒有邀請。</p> : invites.map((invite) => (
          <div className="card" key={invite.id}>
            <strong>{stores.find((store) => store.id === invite.storeId)?.name ?? invite.storeId}</strong>
            <div className="muted">{invite.targetUserId} · 到期 {new Date(invite.expiresAt).toLocaleDateString()}</div>
            <div className="row">
              <span>{invite.revokedAt ? "已撤銷" : invite.acceptedAt ? "已接受" : "待接受"}</span>
              {!invite.acceptedAt && !invite.revokedAt && <button className="btn small" onClick={() => void revoke(invite.id)}>撤銷</button>}
              {!!invite.acceptedAt && !invite.revokedAt && <button className="btn small" onClick={() => void revokeManager(invite)}>撤銷店家權限</button>}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

export function restoreRememberedPath() {
  const next = consumeReturnPath();
  if (next && next !== safeCurrentPath()) navigate(next, true);
}
