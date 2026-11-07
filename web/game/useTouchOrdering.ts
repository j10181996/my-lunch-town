import { useEffect, useRef, type RefObject } from "react";
import type { SceneId } from "../../shared/contracts";
import type { Game } from "./game";

/** 指標事件保留桌面點擊；只把短、未拖動的手勢視為點餐。 */
export function useTouchOrdering(canvasRef: RefObject<HTMLCanvasElement | null>, gameRef: RefObject<Game | null>,
  scene: SceneId, canOrder: boolean, onPick: (id: string) => void) {
  const latest = useRef({ scene, canOrder, onPick });
  latest.current = { scene, canOrder, onPick };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let start: { id: number; x: number; y: number; at: number; scene: SceneId } | null = null;
    const reset = () => { start = null; };
    const down = (e: PointerEvent) => {
      if (e.isPrimary && e.button === 0 && latest.current.canOrder) {
        start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), scene: latest.current.scene };
      }
    };
    const move = (e: PointerEvent) => {
      if (start?.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) reset();
    };
    const up = (e: PointerEvent) => {
      const began = start; reset();
      if (!began || began.id !== e.pointerId || began.scene !== latest.current.scene || !latest.current.canOrder
        || performance.now() - began.at > 600 || Math.hypot(e.clientX - began.x, e.clientY - began.y) > 10) return;
      const id = gameRef.current?.productAt(e.clientX, e.clientY);
      if (id) latest.current.onPick(id);
    };
    const label = canvas.getAttribute("aria-label");
    canvas.classList.add("game-canvas");
    canvas.setAttribute("aria-label", "午餐小鎮街景，可用方向鍵、WASD 或觸控搖桿移動；店內餐點可直接點選");
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", reset);
    canvas.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    return () => {
      canvas.classList.remove("game-canvas");
      if (label !== null) canvas.setAttribute("aria-label", label);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", reset);
      canvas.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
    };
  }, [canvasRef, gameRef]);
}
