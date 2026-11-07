import { useEffect, useState, type FormEvent } from "react";
import type { CreateStoreResult, TownLot } from "../../shared/contracts";
import { STYLES } from "../../shared/town";
import { storeGateway } from "../adapters/http";
import { errorText, newRequestId } from "../api";
import { navigate } from "../router";
import { CopyButton, Modal, Storefront, TopBar } from "../ui";
import { TownMap } from "../TownMap";

export function LotPicker({ town, value, onChange, selfId }: { town: TownLot[]; value: number | null; onChange(i: number): void; selfId?: string }) {
  return (
    <div role="group" aria-label="選擇地段">
      <TownMap
        town={town}
        renderLot={(lot) => {
          const taken = !!lot.store && lot.store.id !== selfId;
          return (
            <button
              type="button"
              className={taken ? "taken" : ""}
              disabled={taken}
              aria-pressed={value === lot.index}
              onClick={() => onChange(lot.index)}
              title={taken ? lot.store!.name : `空地 ${lot.index + 1}`}
            >
              {lot.store && taken ? lot.store.name : value === lot.index ? "★ 你的店" : `空地 ${lot.index + 1}`}
            </button>
          );
        }}
      />
    </div>
  );
}

export function StylePicker({ value, onChange }: { value: string; onChange(k: string): void }) {
  return (
    <div className="style-grid" role="group" aria-label="店面風格">
      {STYLES.map((s) => (
        <button type="button" key={s.key} aria-pressed={value === s.key} onClick={() => onChange(s.key)}>
          <Storefront styleKey={s.key} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function ShopNew() {
  const [town, setTown] = useState<TownLot[]>([]);
  const [name, setName] = useState("");
  const [styleKey, setStyleKey] = useState(STYLES[0].key);
  const [lot, setLot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(newRequestId);
  const [result, setResult] = useState<CreateStoreResult | null>(null);

  useEffect(() => {
    storeGateway
      .getTown()
      .then((t) => {
        setTown(t);
        setLot((cur) => cur ?? t.find((l) => !l.store)?.index ?? null);
      })
      .catch(() => setError("讀取小鎮地圖失敗，請重新整理"));
  }, []);

  const full = town.length > 0 && town.every((l) => l.store);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lot === null) return;
    setBusy(true);
    setError("");
    try {
      setResult(await storeGateway.createStore({ name, styleKey, lotIndex: lot, requestId }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      storeGateway.getTown().then(setTown).catch(() => {});
    }
  }

  return (
    <div className="page">
      <TopBar>
        <span className="sep" />
        <span className="title">開一家新店</span>
      </TopBar>
      <main className="page-body" style={{ maxWidth: 760 }}>
        <form className="panel" onSubmit={submit}>
          <h2>1．店名</h2>
          <label className="field">
            <span className="sr-only">店名</span>
            <input type="text" value={name} maxLength={12} placeholder="例如：咖哩小屋" onChange={(e) => setName(e.target.value)} required autoFocus />
            <small>1 至 12 個字，會顯示在街區招牌與店內</small>
          </label>

          <h2>2．店面風格</h2>
          <StylePicker value={styleKey} onChange={setStyleKey} />

          <h2>3．選一塊地</h2>
          {full ? <div className="banner info">小鎮目前沒有空地了</div> : <LotPicker town={town} value={lot} onChange={setLot} />}

          {error && <div className="banner error">{error}</div>}
          <button className="btn green big" disabled={busy || !name.trim() || lot === null}>
            {busy ? "開店中…" : "開店！接著上架菜單"}
          </button>
        </form>
      </main>

      {result && (
        <Modal title="開店成功！請保存管理碼">
          {result.manageKey ? (
            <>
              <p style={{ margin: 0 }}>
                這組管理碼<strong>只會顯示這一次</strong>。換裝置或清除瀏覽資料後，要靠它找回「{result.profile.name}」的後台。
              </p>
              <div className="key-box">{result.manageKey}</div>
              <div className="row">
                <CopyButton text={result.manageKey} label="複製管理碼" />
              </div>
            </>
          ) : (
            <p style={{ margin: 0 }}>這家店剛剛已建立，管理碼在第一次建立時已顯示。</p>
          )}
          <button className="btn primary big" onClick={() => navigate(result.adminPath, true)}>
            前往店家後台上架菜單
          </button>
        </Modal>
      )}
    </div>
  );
}
