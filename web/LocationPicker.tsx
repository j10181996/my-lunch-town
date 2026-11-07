import { useState } from "react";
import type { GeoPoint } from "../shared/contracts";
import { formatGeo, mapsUrl, parseGeoText } from "../shared/geo";

/**
 * 真實位置選擇：瀏覽器定位，或貼上 Google 地圖的座標／網址。
 * 不串 geocoding API；定位權限只在 https 或 localhost 可用。
 */
export function LocationPicker({ value, onChange, label, disabled }: {
  value: GeoPoint | null;
  onChange(p: GeoPoint | null): void;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  function locate() {
    setError("");
    if (!("geolocation" in navigator)) {
      setError("這個瀏覽器不支援定位，請改貼上座標");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = parseGeoText(`${pos.coords.latitude},${pos.coords.longitude}`);
        if (p) { setText(""); onChange(p); } else setError("取得的位置格式錯誤，請改貼上座標");
      },
      (e) => {
        setLocating(false);
        setError(e.code === e.PERMISSION_DENIED ? "沒有定位權限，請允許定位或改貼上座標" : "暫時無法取得位置，請再試一次或改貼上座標");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function paste(v: string) {
    setText(v);
    setError("");
    if (!v.trim()) return;
    const p = parseGeoText(v);
    if (p) onChange(p);
    else setError("看不懂這個座標，請貼上像「24.147736, 120.673648」的格式");
  }

  return (
    <div className="stack location-picker">
      <div className="row">
        <button type="button" className="btn small green" disabled={disabled || locating} onClick={locate}>
          {locating ? "定位中…" : "📍 用我目前的位置"}
        </button>
      </div>
      <label className="field">
        或貼上座標 <small>Google 地圖在位置上按右鍵，點第一行的數字即可複製</small>
        <input type="text" inputMode="decimal" value={text} disabled={disabled}
          placeholder="例：24.147736, 120.673648" aria-label={`${label}座標`}
          onChange={(e) => paste(e.target.value)} />
      </label>
      {error && <div className="banner error" role="alert">{error}</div>}
      {value && <small className="location-value">
        {label}：{formatGeo(value)} · <a href={mapsUrl(value)} target="_blank" rel="noreferrer">在 Google 地圖查看</a>
      </small>}
    </div>
  );
}
