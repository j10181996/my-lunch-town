import { useEffect, useState } from "react";
import type { ManagementStoreList } from "../../shared/contracts";
import { request, errorText } from "../api";
import { link } from "../router";
import { TopBar } from "../ui";
import { styleOf } from "../../shared/town";

const week = ["日", "一", "二", "三", "四", "五", "六"];
export function StoreList() {
  const [data, setData] = useState<ManagementStoreList | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    request<ManagementStoreList>("GET", "/api/management/stores").then((value) => {
      if (active) setData(value);
    }).catch((e) => { if (active) { setError(errorText(e)); setData(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [generation]);
  const stores = data?.stores ?? [];
  const query = search.trim().toLocaleLowerCase();
  const filtered = stores.filter((store) => (!query || [store.name, styleOf(store.styleKey).label].some((value) => value.toLocaleLowerCase().includes(query)))
    && (status === "all" || (status === "open" ? store.accepting : !store.accepting)));
  const detail = stores.find((store) => store.id === selected);
  return <div className="page">
    <TopBar><span className="spacer" /><a className="btn" {...link("/")}>回小鎮首頁</a></TopBar>
    <main className="page-body store-directory">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><h1>店家管理</h1><p className="muted">查看全部店家，選擇店家進入後台管理。</p></div>
          <button className="btn" disabled={loading} onClick={() => setGeneration((n) => n + 1)}>重新整理</button>
        </div>
        {loading && <p role="status">載入店家清單中…</p>}
        {error && <div className="banner error" role="alert">{error}<button className="btn small" onClick={() => setGeneration((n) => n + 1)}>重試</button></div>}
        {data && !loading && <>
          <div className="directory-counts" aria-label="店家統計">
            <div className="card"><strong>{stores.length}</strong><span>店家總數</span></div>
            <div className="card"><strong>{stores.filter((s) => s.accepting).length}</strong><span>目前可接新團</span></div>
            <div className="card"><strong>{stores.filter((s) => !s.accepting).length}</strong><span>目前未接新團</span></div>
          </div>
          <div className="row">
            <label className="field directory-search">搜尋店家<input type="search" value={search} placeholder="輸入店名或類型" onChange={(e) => setSearch(e.target.value)} /></label>
            <label className="field">接單狀態<select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">全部狀態</option><option value="open">可接新團</option><option value="closed">未接新團</option>
            </select></label>
          </div>
          {stores.length === 0 ? <p role="status">小鎮目前沒有店家。</p>
            : !filtered.length ? <div role="status">找不到符合條件的店家。<button className="btn small" onClick={() => { setSearch(""); setStatus("all"); }}>清除篩選</button></div>
            : <div className="directory-table"><table>
              <caption>店家清單，共 {filtered.length} 家</caption>
              <thead><tr><th scope="col">店家</th><th scope="col">接單狀態</th><th scope="col">菜單</th><th scope="col">進行中的團</th><th scope="col">管理</th></tr></thead>
              <tbody>{filtered.map((store) => <tr key={store.id}>
                <th scope="row"><strong>{store.name}</strong><small>{styleOf(store.styleKey).label} · 第 {store.lotIndex + 1} 號店面</small></th>
                <td><span className={`tag ${store.accepting ? "directory-open" : ""}`}>{store.accepting ? "可接新團" : store.manualStatus === "resting" ? "手動休息" : store.canViewDetails && !store.availableMealCount ? "沒有供應中餐點" : "未接新團"}</span></td>
                <td>{store.canViewDetails ? `${store.availableMealCount} / ${store.mealCount} 道供應中` : "—"}</td><td>{store.activeRoomCount === null ? "—" : `${store.activeRoomCount} 團`}</td>
                <td><div className="row"><button className="btn small" aria-expanded={selected === store.id} onClick={() => setSelected(selected === store.id ? null : store.id)} aria-label={`查看${store.name}摘要`}>查看摘要</button>
                  {store.managePath && <a className="btn green small" {...link(store.managePath)}>管理店家</a>}
                </div></td>
              </tr>)}</tbody>
            </table></div>}
          <small className="muted">接單狀態以本次載入的台灣時間與供應中餐點判斷；按重新整理可取得最新狀態。</small>
        </>}
      </section>
      {detail && !loading && <section className="panel stack" aria-label={`${detail.name}摘要`}>
        <div className="row" style={{ justifyContent: "space-between" }}><h2>{detail.name}</h2><button className="btn small" onClick={() => setSelected(null)}>關閉摘要</button></div>
        {detail.canViewDetails ? <><p>{detail.providesDelivery ? "提供外送" : "以自取為主"} · {detail.managed ? "已設定店家管理者" : "尚未設定店家管理者"}</p>
        <h3>每週營業時間（台灣時間）</h3>
        {detail.hours ? <><ul>{detail.hours.weekly.map((slots, day) => <li key={day}>星期{week[day]}：{slots.length ? slots.map((slot) => `${slot.open}–${slot.close}${slot.close < slot.open ? "（隔天）" : ""}`).join("、") : "公休"}</li>)}</ul>
          <p>每日接單截止：{detail.hours.cutoff ?? "未設定"}</p></> : <p>未設定每週時段，依手動營業狀態接單。</p>}</> : <p>詳細營業設定與菜單請進入店家後台查看。</p>}
        {detail.managePath && <a className="btn green" {...link(detail.managePath)}>進入{detail.name}後台</a>}
      </section>}
    </main>
  </div>;
}
