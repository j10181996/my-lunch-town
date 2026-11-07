import type { ReactNode } from "react";
import type { TownLot } from "../shared/contracts";
import { BUILDING_H, BUILDING_W, LOTS, STREET_H, STREET_W } from "../shared/town";

/**
 * 依地段實際座標畫的小地圖（開店選地段、首頁街景共用）。
 * renderLot 回傳每塊地要顯示的內容；位置與大小由這裡依世界座標換算成百分比。
 */
export function TownMap({ town, renderLot }: {
  town: TownLot[];
  renderLot(lot: TownLot): ReactNode;
}) {
  return (
    <div className="town-map" style={{ aspectRatio: `${STREET_W} / ${STREET_H}` }}>
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
