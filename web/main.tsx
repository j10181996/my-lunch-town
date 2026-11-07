import { StoreList } from "./management/StoreList";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { usePath } from "./router";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";
import { TownWalk } from "./pages/TownWalk";
import { ShopHome } from "./shop-admin/ShopHome";
import { ShopNew } from "./shop-admin/ShopNew";
import { ShopAdmin } from "./shop-admin/ShopAdmin";
import { NotFound } from "./pages/NotFound";

// Canvas text does not trigger CSS font downloads by itself. The render loop
// picks up the loaded faces on the next frame; failure keeps the fallback usable.
void Promise.all([
  document.fonts.load('16px "Cubic 11"'),
  document.fonts.load('400 16px "Noto Sans TC"'),
  document.fonts.load('700 16px "Noto Sans TC"'),
]).catch(() => {});

function App() {
  const path = usePath();
  let m: RegExpMatchArray | null;
  if (path === "/management/stores") return <StoreList />;
  if (path === "/") return <Home />;
  if (path === "/town" || path === "/town/") return <TownWalk />;
  if ((m = path.match(/^\/r\/([\w-]+)\/?$/))) return <RoomPage key={m[1]} roomId={m[1]} />;
  if (path === "/shop" || path === "/shop/") return <ShopHome />;
  if (path === "/shop/new") return <ShopNew />;
  if ((m = path.match(/^\/shop\/([\w-]+)\/?$/))) return <ShopAdmin key={m[1]} storeId={m[1]} />;
  return <NotFound />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
