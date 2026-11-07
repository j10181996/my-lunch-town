import { useEffect, useRef, useState } from "react";
import { EMOTES, type EmoteId } from "../../shared/social";
import "./emotes.css";

export function EmoteControls({ disabled, onSend }: { disabled: boolean; onSend(id: EmoteId): void }) {
  const [open, setOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlsRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return <div className="town-controls" ref={controlsRef} data-emotes-open={open}>
    <button className="mobile-emote-toggle" ref={toggleRef} aria-label="表情" aria-expanded={open}
      aria-controls="town-emotes" disabled={disabled} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">😊</span><small>表情</small>
    </button>
    <div id="town-emotes" className="emote-bar" role="group" aria-label="小鎮表情">
      {EMOTES.map((emote) => <button key={emote.id} className="emote-btn" title={emote.label}
        aria-label={emote.label} disabled={disabled} onClick={() => { setOpen(false); onSend(emote.id); }}>{emote.icon}</button>)}
    </div>
  </div>;
}
