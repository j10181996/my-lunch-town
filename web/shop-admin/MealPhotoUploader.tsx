import { useEffect, useRef, useState } from "react";
import { storeGateway } from "../adapters/http";
import { errorText } from "../api";
import { prepareMealPhoto } from "./meal-photo";
import type { MealDish } from "./meal-photo-style";
import { MealImg } from "../ui";

const DISHES: Array<{ id: MealDish; label: string; reference: string }> = [
  { id: "bento", label: "便當盒", reference: "meal-chicken-bento" },
  { id: "bowl", label: "餐碗", reference: "meal-dry-noodle" },
  { id: "plate", label: "餐盤", reference: "meal-curry-rice" },
];

export function MealPhotoUploader({ storeId, onUse, onBusy }: { storeId: string; onUse(key: string): void; onBusy(busy: boolean): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [dish, setDish] = useState<MealDish>("bento");
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof prepareMealPhoto>> | null>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setPhoto(null); setError("");
    setProcessing(!!file);
    if (!file) return;
    prepareMealPhoto(file, fit, dish).then((value) => { if (active) setPhoto(value); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "照片處理失敗，請換一張"); })
      .finally(() => { if (active) setProcessing(false); });
    return () => { active = false; };
  }, [file, fit, dish]);
  async function upload() {
    if (!photo || uploading) return;
    setUploading(true); onBusy(true); setError("");
    try {
      const result = await storeGateway.uploadImage(storeId, photo.pixels);
      if (alive.current) onUse(result.imageAssetKey);
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setUploading(false); onBusy(false); }
  }
  return <section className="stack photo-uploader" aria-label="上傳餐點照片">
    <h4>上傳自己的餐點照片</h4>
    <label className="field">選擇照片（PNG／JPEG，最多 5 MB）
      <input type="file" accept="image/png,image/jpeg" disabled={uploading} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    </label>
    {file && <label className="field">照片構圖<select value={fit} disabled={uploading} onChange={(e) => setFit(e.target.value as "cover" | "contain")}>
      <option value="cover">置中裁切成正方形</option><option value="contain">保留完整照片</option>
    </select></label>}
    {file && <fieldset className="photo-dishes" disabled={uploading}>
      <legend>小鎮餐具</legend><div role="group" aria-label="餐具外型">{DISHES.map((option) =>
        <button type="button" key={option.id} className="btn small" aria-pressed={dish === option.id} onClick={() => setDish(option.id)}>{option.label}</button>,
      )}</div>
    </fieldset>}
    {processing && <p role="status">正在製作點陣預覽…</p>}
    {photo && <><div className="photo-comparison" aria-label="餐點風格比較">
      <figure><img src={photo.originalPreview} width={96} height={96} alt="轉換前的照片構圖" /><figcaption>照片構圖</figcaption></figure>
      <figure className="photo-result"><img src={photo.preview} className="pixel" width={96} height={96} alt="小鎮風格餐點預覽" /><figcaption>套用後</figcaption></figure>
      <figure><MealImg assetKey={DISHES.find((option) => option.id === dish)!.reference} size={96} alt="內建餐點風格參考" /><figcaption>內建風格</figcaption></figure>
    </div><p className="muted photo-note">暖色食材、深棕描邊，餐具外保留透明留白。請選擇適合餐點的餐具；原照片只在本機處理。</p></>}
    {error && <div className="banner error" role="alert">{error}</div>}
    <button type="button" className="btn green" disabled={!photo || processing || uploading} onClick={() => void upload()}>{uploading ? "上傳中…" : "使用這張點陣圖"}</button>
    <small className="muted">套用後請儲存餐點。換圖只影響之後開的團，既有團保留原圖。</small>
  </section>;
}
