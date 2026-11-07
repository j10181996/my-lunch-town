import type { ReactNode } from "react";
import type { Point, TownLot } from "../shared/contracts";
import { BUILDING_H, BUILDING_W, LOTS, STREET_H, STREET_W } from "../shared/town";

/**
 * 依地段實際座標畫的小地圖（開店選地段、首頁街景共用）。
 * renderLot 回傳每塊地要顯示的內容；位置與大小由這裡依世界座標換算成百分比。
 */
export function TownMap({ town, renderLot, onPick, marker }: {
  town: TownLot[];
  renderLot(lot: TownLot): ReactNode;
  onPick?(point: Point): void;
  marker?: Point | null;
}) {
  return (
    <div
      className={`town-map${onPick ? " pickable" : ""}`}
      style={{ aspectRatio: `${STREET_W} / ${STREET_H}` }}
      aria-label={onPick ? "送餐地點地圖" : undefined}
      onClick={onPick ? (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const border = e.currentTarget.clientLeft;
        onPick({
          x: Math.max(0, Math.min(1, (e.clientX - rect.left - border) / e.currentTarget.clientWidth)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top - border) / e.currentTarget.clientHeight)),
        });
      } : undefined}
    >
      {marker && <span className="delivery-marker" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
        aria-label="送餐地點">⚑</span>}
      {town.map((lot) => {
        const def = LOTS[lot.index];
        if (!def) return null;
        return (
          <div
            key={lot.index}
            className="town-lot"
            style={{
              left: `${(def.bx / STREET_W) * 100}%`,
              top: `${(def.by / STREET_H) * 100}%`,
              width: `${(BUILDING_W / STREET_W) * 100}%`,
              height: `${(BUILDING_H / STREET_H) * 100}%`,
            }}
          >
            {renderLot(lot)}
          </div>
        );
      })}
    </div>
  );
}
