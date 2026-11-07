import { useState, type FormEvent } from "react";
import type { PaymentInfo, PaymentMethod, RoomSnapshot } from "../../shared/contracts";
import { validatePaymentInfo } from "../../shared/payment";
import { errorText } from "../api";
import { CopyButton, Modal, money } from "../ui";

const methodLabels: Record<PaymentMethod["type"], string> = {
  bank: "銀行轉帳",
  linepay: "LINE Pay",
  jkopay: "街口",
  cash: "現金",
  other: "其他",
};
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
      <p className="muted">只傳遞收款資訊，不經手金流。收單後才能傳送給團員。</p>
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
          {(method.type === "linepay" || method.type === "jkopay") && <label className="field">
            {methodLabels[method.type]} ID
            <input type="text" maxLength={40} value={method.id}
              onChange={(e) => update(index, { ...method, id: e.target.value })} />
          </label>}
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
    {info.methods.map((method, i) => <div className="payment-method stack" key={i}>
      <strong>{methodLabels[method.type]}</strong>
      {method.type === "bank" && <>
        <div>銀行代碼：{method.bankCode}</div>
        <div className="row">帳號：{method.account}<CopyButton text={method.account} /></div>
        <div>戶名：{method.holder}</div>
      </>}
      {(method.type === "linepay" || method.type === "jkopay") &&
        <div className="row">ID：{method.id}<CopyButton text={method.id} /></div>}
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
