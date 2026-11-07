import { DEFAULT_MEAL_ART } from "../shared/town";
import type { StoreOrderStatus } from "../shared/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AVATARS } from "../shared/town";
import { avatarDataUrl } from "./art/characters";
import { mealImageUrl } from "./art/meals";
import { storefrontPreview } from "./art/scenes";
import { link } from "./router";

export function money(n: number) {
  return `NT$${n.toLocaleString("en-US")}`;
}

export function MealImg({ assetKey, alt, size = 96 }: { assetKey: string; alt: string; size?: number }) {
  const src = useMemo(() => mealImageUrl(assetKey), [assetKey]);
  return <img className="pixel" src={src} alt={alt} width={size} height={size} onError={(event) => {
    const image = event.currentTarget;
    const fallback = mealImageUrl(DEFAULT_MEAL_ART);
    if (image.getAttribute("src") !== fallback) image.src = fallback;
  }} />;
}

export function Storefront({ styleKey, resting = false }: { styleKey: string; resting?: boolean }) {
  const src = useMemo(() => storefrontPreview(styleKey, resting).toDataURL(), [styleKey, resting]);
  return <img className="pixel" src={src} alt="" style={{ width: "100%", height: "auto" }} />;
}

export function Logo() {
  const src = useMemo(() => mealImageUrl("meal-chicken-bento"), []);
  return (
    <a className="logo" {...link("/")}>
      <img className="pixel" src={src} alt="" />
      午餐小鎮
    </a>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Logo />
      {children}
    </header>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** 複製到剪貼簿；失敗時呼叫端應顯示可選取的文字框。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "複製" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <>
      <button
        className="btn small"
        onClick={async () => {
          const ok = await copyText(text);
          setState(ok ? "ok" : "fail");
          if (ok) setTimeout(() => setState("idle"), 1600);
        }}
      >
        {state === "ok" ? "已複製" : label}
      </button>
      {state === "fail" && (
        <input type="text" readOnly value={text} onFocus={(e) => e.currentTarget.select()} aria-label="複製失敗，請手動選取" autoFocus />
      )}
    </>
  );
}

export const orderStatusLabels: Record<StoreOrderStatus, string> = {
  sent: "已送出", accepted: "店家已接單", preparing: "製作中", ready: "可取餐", rejected: "已拒單",
};
export function OrderStatusBadge({ status }: { status: StoreOrderStatus }) {
  return <span className={`order-status ${status}`}>{orderStatusLabels[status]}</span>;
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const avatars = useMemo(() => AVATARS.map((a) => ({ ...a, src: avatarDataUrl(a.id) })), []);
  return (
    <div className="field">
      選一個角色
      <div className="avatar-pick" role="group" aria-label="角色">
        {avatars.map((a) => (
          <button type="button" key={a.id} aria-pressed={value === a.id} onClick={() => onChange(a.id)} aria-label={`${a.label}色角色`}>
            <img className="pixel" src={a.src} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
