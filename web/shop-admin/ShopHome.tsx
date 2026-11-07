import { useEffect, useState, type FormEvent } from "react";
import type { StoreProfile } from "../../shared/contracts";
import { storeGateway } from "../adapters/http";
import { errorText } from "../api";
import { link, navigate } from "../router";
import { TopBar } from "../ui";

/** 店家入口：開新店、進入自己的店、用管理碼找回店。與揪團者的首頁分開。 */
export function ShopHome() {
  const [mine, setMine] = useState<StoreProfile[]>([]);
  const [key, setKey] = useState("");
  const [claimError, setClaimError] = useState("");

  useEffect(() => {
    storeGateway.myStores().then(setMine).catch(() => {});
  }, []);

  async function claim(e: FormEvent) {
    e.preventDefault();
    setClaimError("");
    try {
      const p = await storeGateway.claimStore(key);
      navigate(`/shop/${p.id}`);
    } catch (err) {
      setClaimError(errorText(err));
    }
  }

  return (
    <div className="page">
      <TopBar>
        <span className="sep" />
        <span className="title">店家入口</span>
        <span className="spacer" />
        <a className="btn" {...link("/")}>
          回小鎮首頁
        </a>
      </TopBar>
      <main className="page-body" style={{ maxWidth: 760 }}>
        <section className="panel">
          <h2>我要開店</h2>
          <p className="muted" style={{ margin: 0 }}>
            在小鎮租一個店面、擺上點陣菜單。營業中的店會出現在之後開的每一團。
          </p>
          <a className="btn green big" {...link("/shop/new")}>
            開一家新店
          </a>
          {mine.length > 0 && (
            <div className="stack">
              <strong>我的店</strong>
              {mine.map((s) => (
                <a key={s.id} className="btn" {...link(`/shop/${s.id}`)} style={{ justifyContent: "space-between" }}>
                  <span>{s.name}</span>
                  <span className="muted">{s.status === "open" ? "營業中" : "休息中"}</span>
                </a>
              ))}
            </div>
          )}
          <form className="stack" onSubmit={claim}>
            <label className="field">
              用管理碼找回我的店 <small>換裝置或清除瀏覽資料後使用</small>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="xxxx-xxxx-xxxx" />
                <button className="btn" disabled={!key.trim()}>
                  認領
                </button>
              </div>
            </label>
            {claimError && <div className="banner error">{claimError}</div>}
          </form>
        </section>
      </main>
    </div>
  );
}
