import { useState, type FormEvent } from "react";
import type { StoreHours, StoreProfile } from "../../shared/contracts";
import { validateStoreHours } from "../../shared/store-hours";
import { storeGateway } from "../adapters/http";


const days = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
export function StoreHoursSettings({ profile, onSaved }: { profile: StoreProfile; onSaved(profile: StoreProfile): void }) {
  const [enabled, setEnabled] = useState(!!profile.hours);
  const [weekly, setWeekly] = useState<StoreHours["weekly"]>(() => profile.hours?.weekly ?? days.map(() => [{ open: "09:00", close: "18:00" }]));
  const [cutoff, setCutoff] = useState(profile.hours?.cutoff ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const update = (day: number, slots: StoreHours["weekly"][number]) => setWeekly((old) => old.map((value, i) => i === day ? slots : value));
  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(""); setError("");
    try {
      const hours = validateStoreHours(enabled ? { weekly, cutoff: cutoff || null } : null);
      setBusy(true);
      onSaved(await storeGateway.setHours(profile.id, hours));
      setMessage("營業時間已儲存，套用到之後開的團");
    } catch (e) { setError(e instanceof Error ? e.message : "無法儲存"); }
    finally { setBusy(false); }
  }
  return <form className="panel stack hours-settings" onSubmit={save} onChange={() => setMessage("")} aria-label="營業時間設定">
    <h2>營業時間與接單截止</h2>
    <p className="muted">使用台灣時間（UTC+8）。手動切為「休息中」仍會停止接新團。</p>
    <fieldset disabled={busy} className="stack">
      <label className="switch"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />依每週時段接單</label>
      {!enabled && <small className="muted">未啟用時，依上方的手動營業狀態接單。</small>}
      {enabled && <>
        {days.map((day, d) => <div className="hours-day stack" key={day}>
          <div className="row"><strong>{day}</strong>{!weekly[d].length && <span className="muted">公休</span>}
            <button type="button" className="btn small" disabled={weekly[d].length >= 3} aria-label={`${day}新增時段`}
              onClick={() => update(d, [...weekly[d], { open: "09:00", close: "18:00" }])}>＋ 時段</button>
          </div>
          {weekly[d].map((slot, i) => <div className="row hours-slot" key={i}>
            <label className="field">開始<input type="time" required value={slot.open} aria-label={`${day}第${i + 1}段開始`}
              onChange={(e) => update(d, weekly[d].map((s, j) => i === j ? { ...s, open: e.target.value } : s))} /></label>
            <label className="field">結束<input type="time" required value={slot.close} aria-label={`${day}第${i + 1}段結束`}
              onChange={(e) => update(d, weekly[d].map((s, j) => i === j ? { ...s, close: e.target.value } : s))} /></label>
            <button type="button" className="btn small" aria-label={`${day}移除第${i + 1}段`} onClick={() => update(d, weekly[d].filter((_, j) => i !== j))}>移除</button>
          </div>)}
        </div>)}
        <small className="muted">移除當天所有時段即為公休。結束早於開始表示跨到隔天；相同時間與重疊時段不接受。</small>
        <label className="field">每日接單截止（選填）<input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></label>
        <button type="button" className="btn small" onClick={() => setCutoff("")}>清除截止時間</button>
        <small className="muted">跨午夜時段中，早於開始的截止時間屬於隔天。截止後收單會提醒團主，仍可確認送出。</small>
      </>}
    </fieldset>
    {error && <div className="banner error" role="alert">{error}</div>}
    {message && <div className="banner info" role="status">{message}</div>}
    <button className="btn green" disabled={busy}>{busy ? "儲存中…" : "儲存營業時間"}</button>
  </form>;
}
