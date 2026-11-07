import { useEffect, useRef, useState, type PointerEvent } from "react";
import { joystickVector } from "./joystick";

export function VirtualJoystick({ disabled, scene, onMove }: {
  disabled: boolean;
  scene: string;
  onMove(x: number, y: number): void;
}) {
  const baseRef = useRef<HTMLButtonElement>(null);
  const active = useRef<number | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  function stop() {
    const id = active.current;
    active.current = null;
    if (id !== null && baseRef.current?.hasPointerCapture(id)) baseRef.current.releasePointerCapture(id);
    moveRef.current(0, 0);
    setOffset({ x: 0, y: 0 });
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    if (active.current !== e.pointerId || disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const vector = joystickVector(dx, dy);
    const length = Math.hypot(dx, dy);
    const scale = length > 38 ? 38 / length : 1;
    setOffset({ x: dx * scale, y: dy * scale });
    moveRef.current(vector.x, vector.y);
  }

  useEffect(() => {
    stop();
    const hidden = () => { if (document.hidden) stop(); };
    const observer = new ResizeObserver(stop);
    const stage = baseRef.current?.closest(".stage");
    if (stage) observer.observe(stage);
    window.addEventListener("blur", stop);
    window.addEventListener("resize", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", stop);
      window.removeEventListener("resize", stop);
      document.removeEventListener("visibilitychange", hidden);
      moveRef.current(0, 0);
    };
  }, [disabled, scene]);

  return <div className="mobile-movement">
    <span className="joystick-caption">按住拖動移動</span>
    <button ref={baseRef} type="button" className="virtual-joystick" disabled={disabled}
      aria-label="角色移動搖桿，按住拖動方向，放開停止"
      onPointerDown={(e) => {
        if (disabled || active.current !== null || !e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={(e) => { if (active.current === e.pointerId) stop(); }}
      onPointerCancel={(e) => { if (active.current === e.pointerId) stop(); }}
      onLostPointerCapture={(e) => { if (active.current === e.pointerId) stop(); }}
      onContextMenu={(e) => e.preventDefault()}>
      <span className="joystick-arrows" aria-hidden="true">✥</span>
      <span className="joystick-thumb" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} aria-hidden="true" />
    </button>
  </div>;
}
