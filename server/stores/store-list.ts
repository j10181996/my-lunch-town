import type { Db } from "../db";
import type { ManagementStore } from "../../shared/contracts";
import { storeOpening } from "../../shared/store-hours";

/** All stores have a public summary; management details retain existing owner checks. */
export function listManagementStores(db: Db, sessionId: string): ManagementStore[] {
  const stores = db.prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM meals m WHERE m.store_id = s.id) AS meal_count,
    (SELECT COUNT(*) FROM meals m WHERE m.store_id = s.id AND m.available = 1) AS available_count,
    (SELECT COUNT(*) FROM room_stores rs JOIN rooms r ON r.id = rs.room_id WHERE rs.store_id = s.id AND r.status = 'open') AS active_rooms
    FROM stores s  ORDER BY s.lot_index, s.id`)
    .all() as Array<{
      id: string; name: string; style_key: string; lot_index: number; status: "open" | "resting";
      hours_json: string | null; delivery_json: string | null; owner_session_id: string | null;
      meal_count: number; available_count: number; active_rooms: number;
    }>;
  const now = Date.now();
  return stores.map((s) => {
    const canViewDetails = s.owner_session_id === sessionId;
    const hours = s.hours_json ? JSON.parse(s.hours_json) : null;
    const delivery = s.delivery_json ? JSON.parse(s.delivery_json) : null;
    const accepting = s.status === "open" && s.available_count > 0 && storeOpening(hours, now).open;
    return {
      id: s.id, name: s.name, styleKey: s.style_key, lotIndex: s.lot_index,
      manualStatus: s.status, accepting, canViewDetails, hours: canViewDetails ? hours : null, mealCount: canViewDetails ? s.meal_count : null, availableMealCount: canViewDetails ? s.available_count : null,
      activeRoomCount: canViewDetails ? s.active_rooms : null, providesDelivery: canViewDetails ? delivery?.enabled === true : null,
      managed: canViewDetails ? s.owner_session_id !== null : null,
      managePath: `/shop/${s.id}`,
    };
  });
}
