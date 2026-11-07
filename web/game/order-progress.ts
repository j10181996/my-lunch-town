/** 出餐進度在小鎮演出（#87）：真人店家在後台改的訂單狀態，交給店主、店門口與團主表現。 */
import type { RoomStoreOrder, StoreOrderStatus } from "../../shared/contracts";

type OrderView = Pick<RoomStoreOrder, "storeId" | "storeName" | "status"> & { fulfillment?: "delivery" | "pickup" };

/** 店主在櫃檯說的進度；還沒送單時為 null。 */
export function shopkeeperProgressLine(status: StoreOrderStatus | null | undefined): string | null {
  switch (status) {
    case "sent": return "單子到了，我確認一下喔！";
    case "accepted": return "收到你們的單了！";
    case "preparing": return "便當在做囉～";
    case "ready": return "做好囉，可以來拿了！";
    case "rejected": return "抱歉，今天這單做不了…";
    default: return null;
  }
}

export type DoorEffect = "smoke" | "bag";

/** 製作中的店門口冒煙，完成的店門口放一袋便當。 */
export function doorEffects(orders: OrderView[] | undefined): Map<string, DoorEffect> {
  const effects = new Map<string, DoorEffect>();
  for (const order of orders ?? []) {
    if (order.status === "preparing") effects.set(order.storeId, "smoke");
    else if (order.status === "ready") effects.set(order.storeId, "bag");
  }
  return effects;
}

/**
 * 團主依店家訂單狀態的變化喊話；只比較前後兩份快照，所以打開舊團不會喊。
 * 拒單最要緊，先喊；多家同時完成時合成一句。接單與製作中交給店主與店門口，團主不喊。
 */
export function ownerOrderCall(previous: OrderView[] | undefined, next: OrderView[] | undefined): string | null {
  const changed = (next ?? []).filter((order) => {
    const old = previous?.find((o) => o.storeId === order.storeId);
    return old && old.status !== order.status;
  });
  const rejected = changed.find((o) => o.status === "rejected");
  if (rejected) return `${rejected.storeName}今天不能做，要換一家了`;
  const ready = changed.filter((o) => o.status === "ready");
  if (ready.length > 1) return `${ready.length} 家都好了，大家來拿！`;
  if (ready.length === 1) {
    return ready[0].fulfillment === "delivery" ? `${ready[0].storeName}做好了，等外送喔！` : `${ready[0].storeName}好了，誰去拿一下！`;
  }
  return null;
}
