import { useRef, useState } from "react";
import type { GeocodeResult, GeoPoint } from "../shared/contracts";
import { mapsUrl } from "../shared/geo";
import { normalizeTwAddress } from "../shared/tw-address";
import { geoGateway } from "./adapters/http";
import { errorText } from "./api";
import { LocationPicker } from "./LocationPicker";

/**
 * 只輸入地址，由伺服器推算座標。按「查詢位置」或離開欄位時查詢（不做邊打字邊查）。
 * 查不到時可展開手動設定（定位／貼座標）。地址一改，舊座標即作廢。
 */
export function AddressLocator({ label, address, location, onAddressChange, onLocationChange, maxLength, placeholder, disabled }: {
  label: string;
  address: string;
  location: GeoPoint | null;
  onAddressChange(address: string): void;
  onLocationChange(location: GeoPoint | null): void;
  maxLength: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  // 目前座標對應的地址；初始帶進來的座標視為對應初始地址。
  const locatedFor = useRef(location ? normalizeTwAddress(address) : "");

  async function locate(): Promise<GeoPoint | null> {
    const text = address.trim();
    if (!text) return null;
    if (location && locatedFor.current === normalizeTwAddress(text)) return location;
    setBusy(true);
    setError("");
    try {
      const r = await geoGateway.geocode(text);
      locatedFor.current = normalizeTwAddress(text);
      setResult(r);
      onLocationChange(r.location);
      return r.location;
    } catch (e) {
      setResult(null);
      onLocationChange(null);
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function edit(value: string) {
    onAddressChange(value);
    if (location && normalizeTwAddress(value) !== locatedFor.current) {
      onLocationChange(null);
      setResult(null);
    }
    setError("");
  }

  return (
    <div className="stack address-locator">
      <label className="field">
        {label} <small>最多 {maxLength} 字；輸入後會自動找出位置</small>
        <div className="row address-row">
          <input type="text" value={address} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
            onChange={(e) => edit(e.target.value)} onBlur={() => { if (!location) void locate(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void locate(); } }} />
          <button type="button" className="btn small" disabled={disabled || busy || !address.trim()}
            onClick={() => void locate()}>{busy ? "查詢中…" : "查詢位置"}</button>
        </div>
      </label>
      {location && <small className={`location-value${result?.precision && result.precision !== "house" ? " approximate" : ""}`} role="status">
        {result?.precision === "house" ? "✓ 已找到門牌位置" : result ? "⚠ 只找到路段位置，距離可能有幾百公尺誤差" : "✓ 已設定位置"}
        {" · "}<a href={mapsUrl(location)} target="_blank" rel="noreferrer">在 Google 地圖查看</a>
        {result && <><br /><span className="muted">{result.label}</span></>}
      </small>}
      {error && <div className="banner error" role="alert">{error}</div>}
      <details open={manual} onToggle={(e) => setManual(e.currentTarget.open)}>
        <summary>查不到或位置不對？手動設定位置</summary>
        <LocationPicker label={label} value={location} disabled={disabled}
          onChange={(p) => { locatedFor.current = normalizeTwAddress(address); setResult(null); setError(""); onLocationChange(p); }} />
      </details>
      <small className="muted attribution">地址定位資料 © OpenStreetMap 貢獻者</small>
    </div>
  );
}
