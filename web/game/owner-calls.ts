/** 團主的收單喊話（#80）：截止與收單是團主的事，由團主角色冒泡泡，不交給店主。 */

/** 截止前多久提醒團員（頂列倒數與提示訊息也用這個時間點）。 */
export const OWNER_REMIND_MS = 5 * 60_000;

export interface OwnerCallRoom { status: "open" | "closed"; deadlineAt?: number | null }

/**
 * 依團的狀態決定團主這一刻要不要喊話。
 * - wasOpen：上一次看到的團是否還在收單；只有親眼看到從收單中變成已收單才喊「收單囉」。
 * - reminded：已提醒過的截止時間；截止時間改了會再提醒一次。
 */
export function ownerCall(room: OwnerCallRoom, wasOpen: boolean, reminded: number | null, now: number):
  { text: string; reminded: number | null } | null {
  if (room.status === "closed") return wasOpen ? { text: "收單囉！謝謝大家～", reminded } : null;
  const at = room.deadlineAt ?? null;
  if (at === null || at === reminded) return null;
  const left = at - now;
  if (left <= 0 || left > OWNER_REMIND_MS) return null;
  return { text: `再 ${Math.ceil(left / 60_000)} 分鐘收單，還沒點的快喔！`, reminded: at };
}
