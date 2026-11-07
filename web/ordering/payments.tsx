import { useMemo, useState, type FormEvent } from "react";
import { encode } from "uqr";
import type { PaymentInfo, PaymentMethod, RoomSnapshot } from "../../shared/contracts";
import { validatePaymentInfo } from "../../shared/payment";
import { paymentQrPayload } from "../../shared/payment-qr";
import { errorText } from "../api";
import { CopyButton, Modal, money } from "../ui";

const methodLabels: Record<PaymentMethod["type"], string> = {
  bank: "銀行轉帳",
  linepay: "LINE Pay",
  jkopay: "街口",
  cash: "現金",
  other: "其他",
};
const clock = (time: number) => new Date(time).toLocaleTimeString("zh-TW", {
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/** 以 SVG 繪製 QR code，相鄰深色格合併成同一條 path 以縮小 DOM。 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let run = 1;
        while (row[x + run]) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run - 1;
      }
    });
    return { size: qr.size, path: d };
  }, [text]);
  return <svg className="payment-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}
    shapeRendering="crispEdges">
    <rect width={size} height={size} fill="#fff" />
    <path d={path} fill="#000" />
  </svg>;
}

function MethodQr({ method, amountTwd }: { method: PaymentMethod; amountTwd?: number }) {
  const payload = paymentQrPayload(method, amountTwd);
  if (!payload) return null;
  const label = methodLabels[method.type];
  if (method.type === "bank") {
    return <div className="payment-qr-box">
      <QrCode text={payload} label={`${label} QR code${amountTwd ? `，金額 ${amountTwd} 元` : ""}`} />
      <small className="muted">
        用網銀或台灣Pay 掃描，會帶入帳號{amountTwd ? `與 ${money(amountTwd)}` : ""}；手機上可截圖後從相簿掃描
      </small>
    </div>;
  }
  return <div className="payment-qr-box">
    <QrCode text={payload} label={`${label} 收款 QR code`} />
    <a className="btn small" href={payload} target="_blank" rel="noopener noreferrer">開啟 {label} 收款連結</a>
  </div>;
}

function blankMethod(type: PaymentMethod["type"]): PaymentMethod {
  switch (type) {
    case "bank": return { type, bankCode: "", account: "", holder: "" };
    case "linepay":
    case "jkopay": return { type, id: "" };
    case "cash": return { type, note: "" };
    case "other": return { type, text: "" };
  }
}
function initialInfo(info?: PaymentInfo): PaymentInfo {
  if (info) return info;
  try {
    const saved = localStorage.getItem("lt-payment-info");
    if (saved) return validatePaymentInfo(JSON.parse(saved));
  } catch { /* 無法讀取或舊設定無效時用空白設定 */ }
  return { methods: [blankMethod("bank")], note: "" };
}
export function PaymentSettings({ info, onSave, onClose }: {
  info?: PaymentInfo;
  onSave(info: PaymentInfo): Promise<void>;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(() => initialInfo(info));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update(index: number, method: PaymentMethod) {
    setDraft((d) => ({ ...d, methods: d.methods.map((m, i) => i === index ? method : m) }));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const info = validatePaymentInfo(draft);
      await onSave(info);
      try { localStorage.setItem("lt-payment-info", JSON.stringify(info)); } catch { /* 私密模式 */ }
      onClose();
    } catch (e) {
      const validation = e as { code?: string; message?: string };
      setError(validation.code === "INVALID_INPUT" && validation.message ? validation.message : errorText(e));
    } finally { setBusy(false); }
  }
  return <Modal title="收款設定" onClose={busy ? undefined : onClose}>
    <form className="stack payment-settings" onSubmit={save}>
      <p className="muted">只傳遞收款資訊，不經手金流。收單後才能傳送給團員。銀行轉帳會自動產生帶入金額的 QR code。</p>
      <fieldset disabled={busy} className="stack">
        {draft.methods.map((method, index) => <div className="card stack" key={index}>
          <label className="field">收款方式 {index + 1}
            <select value={method.type}
              onChange={(e) => update(index, blankMethod(e.target.value as PaymentMethod["type"]))}>
              {Object.entries(methodLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </select>
          </label>
          {method.type === "bank" && <>
            <label className="field">銀行代碼
              <input type="text" inputMode="numeric" maxLength={3} value={method.bankCode}
                onChange={(e) => update(index, { ...method, bankCode: e.target.value })} />
            </label>
            <label className="field">帳號
              <input type="text" maxLength={20} value={method.account}
                onChange={(e) => update(index, { ...method, account: e.target.value })} />
            </label>
            <label className="field">戶名
              <input type="text" maxLength={20} value={method.holder}
                onChange={(e) => update(index, { ...method, holder: e.target.value })} />
            </label>
          </>}
          {(method.type === "linepay" || method.type === "jkopay") && <>
            <label className="field">
              {methodLabels[method.type]} ID
              <input type="text" maxLength={40} value={method.id}
                onChange={(e) => update(index, { ...method, id: e.target.value })} />
            </label>
            <label className="field">收款連結 <small>選填，從 {methodLabels[method.type]} App 複製；填了團員會看到 QR code</small>
              <input type="url" inputMode="url" maxLength={300} placeholder="https://" value={method.link ?? ""}
                onChange={(e) => update(index, { ...method, link: e.target.value })} />
            </label>
          </>}
          {method.type === "cash" && <label className="field">現金說明
            <input type="text" maxLength={40} value={method.note}
              onChange={(e) => update(index, { ...method, note: e.target.value })} />
          </label>}
          {method.type === "other" && <label className="field">收款說明
            <input type="text" maxLength={60} value={method.text}
              onChange={(e) => update(index, { ...method, text: e.target.value })} />
          </label>}
          <button type="button" className="btn small" disabled={draft.methods.length === 1}
            onClick={() => setDraft((d) => ({ ...d, methods: d.methods.filter((_, i) => i !== index) }))}>
            移除收款方式 {index + 1}
          </button>
        </div>)}
        <button type="button" className="btn" disabled={draft.methods.length >= 4}
          onClick={() => setDraft((d) => ({ ...d, methods: [...d.methods, blankMethod("bank")] }))}>
          新增收款方式
        </button>
        <label className="field">備註
          <textarea maxLength={100} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </label>
      </fieldset>
      {error && <div className="banner error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>取消</button>
      </div>
    </form>
  </Modal>;
}
export function PaymentCard({ snap, busy, onReport }: {
  snap: RoomSnapshot;
  busy: boolean;
  onReport(): void;
}) {
  if (!snap.payment || snap.me.role === "owner") return null;
  const { info, ownerNickname } = snap.payment;
  const mine = snap.myPayment;
  return <section className="card stack payment-card" aria-label="付款">
    <h3 className="section-title">付款</h3>
    {mine ? <div>付款給 {ownerNickname}：你要付 <strong>{money(mine.amountTwd)}</strong></div>
      : <div>你這團沒有點餐，不用付款</div>}
    {mine?.status === "unpaid" && mine.remindedAt != null &&
      <div className="banner info" role="status">{ownerNickname} 在 {clock(mine.remindedAt)} 提醒你付款</div>}
    {info.methods.map((method, i) => <div className="payment-method stack" key={i}>
      <strong>{methodLabels[method.type]}</strong>
      {method.type === "bank" && <>
        <div>銀行代碼：{method.bankCode}</div>
        <div className="row">帳號：{method.account}<CopyButton text={method.account} /></div>
        <div>戶名：{method.holder}</div>
      </>}
      {(method.type === "linepay" || method.type === "jkopay") &&
        <div className="row">ID：{method.id}<CopyButton text={method.id} /></div>}
      {mine && <MethodQr method={method} amountTwd={mine.amountTwd} />}
      {method.type === "cash" && <div>{method.note || "現金交給團主"}</div>}
      {method.type === "other" && <div>{method.text}</div>}
    </div>)}
    {info.note && <div className="payment-note">{info.note}</div>}
    {mine?.status === "unpaid" &&
      <button className="btn primary" disabled={busy} onClick={onReport}>我已付款</button>}
    {mine?.status === "reported" && <div className="banner info">已回報付款，等待團主確認</div>}
    {mine?.status === "confirmed" && <div className="banner ok">✓ 團主已確認收到</div>}
  </section>;
}

/** 團主的提醒按鈕：只有收單、已傳送收款資訊且仍有未付款團員時可用。 */
export function PaymentReminder({ snap, unpaidCount, busy, onRemind }: {
  snap: RoomSnapshot;
  unpaidCount: number;
  busy: boolean;
  onRemind(): void;
}) {
  if (snap.room.status !== "closed" || snap.payment?.sentAt == null) return null;
  const remindedAt = snap.payment.remindedAt ?? null;
  return <div className="stack">
    <button className="btn" disabled={busy || unpaidCount === 0} onClick={onRemind}>
      {unpaidCount === 0 ? "所有人都已回報付款" : `提醒 ${unpaidCount} 位未付款的團員`}
    </button>
    {remindedAt != null && <div className="muted">上次提醒：{clock(remindedAt)}（只有未付款的人會看到）</div>}
  </div>;
}
