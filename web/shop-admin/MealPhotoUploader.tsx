import { useEffect, useRef, useState } from "react";
import { storeGateway } from "../adapters/http";
import { errorText } from "../api";
import { prepareMealPhoto } from "./meal-photo";

export function MealPhotoUploader({ storeId, onUse, onBusy }: { storeId: string; onUse(key: string): void; onBusy(busy: boolean): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [photo, setPhoto] = useState<{ pixels: number[]; preview: string } | null>(null);
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
    prepareMealPhoto(file, fit).then((value) => { if (active) setPhoto(value); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "照片處理失敗，請換一張"); })
      .finally(() => { if (active) setProcessing(false); });
    return () => { active = false; };
  }, [file, fit]);
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
    {processing && <p role="status">正在製作點陣預覽…</p>}
    {photo && <div className="photo-preview"><img src={photo.preview} className="pixel" width={160} height={160} alt="32×32 餐點點陣預覽" /><p>32×32、64 色加透明。確認後上傳這張點陣圖；原照片不會上傳。</p></div>}
    {error && <div className="banner error" role="alert">{error}</div>}
    <button type="button" className="btn green" disabled={!photo || processing || uploading} onClick={() => void upload()}>{uploading ? "上傳中…" : "使用這張點陣圖"}</button>
    <small className="muted">套用後請儲存餐點。換圖只影響之後開的團，既有團保留原圖。</small>
  </section>;
}
