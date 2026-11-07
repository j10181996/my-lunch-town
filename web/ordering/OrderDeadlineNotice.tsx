import { useEffect, useState } from "react";
import type { RoomSnapshot } from "../../shared/contracts";

export function OrderDeadlineNotice({ snap }: { snap: RoomSnapshot }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const passed = snap.catalog.stores.filter((store) => store.orderDeadlineAt != null && now >= store.orderDeadlineAt
    && snap.storeTotals.some((total) => total.storeId === store.id && total.totalQuantity > 0));
  if (!passed.length) return null;
  return <div className="banner info" role="status" aria-label="接單截止提醒">
    {passed.map((store) => <p key={store.id}>{store.name} 已過接單截止（台灣時間 {new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(store.orderDeadlineAt!)}）。請先確認店家是否仍可接單。</p>)}
    <small>此提醒不會取消餐點；確認收單後仍會送出訂單。</small>
  </div>;
}
