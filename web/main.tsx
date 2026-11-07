import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { usePath } from "./router";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";
import { ShopNew } from "./shop-admin/ShopNew";
import { ShopAdmin } from "./shop-admin/ShopAdmin";
import { NotFound } from "./pages/NotFound";
import { request } from "./api";
import type { SessionInfo } from "../shared/auth";
import { AdminInvites, AuthProvider, InviteAccept, isSitesBuild, NotMember, restoreRememberedPath, SignInCard, StoreOnlyHome } from "./auth";

function Routes({ path }: { path: string }) {
  let m: RegExpMatchArray | null;
  if (path === "/") return <Home />;
  if ((m = path.match(/^\/r\/([\w-]+)\/?$/))) return <RoomPage key={m[1]} roomId={m[1]} />;
  if (path === "/shop/new") return <ShopNew />;
  if ((m = path.match(/^\/shop\/([\w-]+)\/?$/))) return <ShopAdmin key={m[1]} storeId={m[1]} />;
  return <NotFound />;
}

function SitesApp() {
  const path = usePath();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    request<SessionInfo>("GET", "/api/auth/session")
      .then((value) => { setSession(value); if (value.authenticated) restoreRememberedPath(); })
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <div className="center muted">無法確認登入狀態，請重新整理。</div>;
  if (!session) return <div className="center muted">確認 ChatGPT 登入狀態中…</div>;
  if (path === "/invite") return <AuthProvider session={session}><InviteAccept session={session} /></AuthProvider>;
  if (!session.authenticated) return <AuthProvider session={session}><SignInCard session={session} /></AuthProvider>;
  const storeMatch = path.match(/^\/shop\/([\w-]+)\/?$/);
  if (storeMatch && !session.storeIds.includes(storeMatch[1])) {
    return <AuthProvider session={session}><StoreOnlyHome session={session} /></AuthProvider>;
  }
  if (!session.member) {
    return <AuthProvider session={session}>{session.storeIds.length ? <StoreOnlyHome session={session} /> : <NotMember session={session} />}</AuthProvider>;
  }
  if (path === "/admin/invites") return <AuthProvider session={session}><AdminInvites /></AuthProvider>;
  if (path === "/shop/new" && !session.admin) return <AuthProvider session={session}><NotMember session={session} /></AuthProvider>;
  return <AuthProvider session={session}><Routes path={path} /></AuthProvider>;
}

function App() {
  const path = usePath();
  return isSitesBuild ? <SitesApp /> : <Routes path={path} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
