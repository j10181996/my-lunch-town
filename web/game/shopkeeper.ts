/** 店內店主的台詞（#80）：純前端、依情境挑一句，不呼叫 API。泡泡寬度有限，台詞盡量在 16 字內。 */

export interface ShopkeeperContext {
  /** 這家目前有供應的餐點，用來推薦。 */
  meals: Array<{ name: string; priceTwd: number }>;
  /** 自己在這家已點的品項。 */
  ordered: Array<{ name: string; quantity: number }>;
  /** 團已收單：不再提示去點餐（收單喊話由團主負責，見 owner-calls.ts）。 */
  roomClosed: boolean;
  /** 店家依營業時間的今日接單截止（毫秒），不是團主設的截止；沒有設定時為 null。 */
  deadlineAt: number | null;
  /** 散步模式：只能逛，不能點餐。 */
  solo: boolean;
  /** 這家不在本團（#78）：能進店看菜單，但不能點餐。 */
  notInRoom?: boolean;
  /** 第幾次和店主說話（從 0 開始），用來輪替台詞。 */
  talk: number;
  now: number;
}

/** 截止前多少分鐘開始提醒。 */
export const DEADLINE_REMIND_MINUTES = 10;

function taipeiHour(now: number) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "numeric", hourCycle: "h23" }).format(now));
}

function greeting(now: number) {
  const hour = taipeiHour(now);
  if (hour < 10) return "早安！今天也準備好了。";
  if (hour < 14) return "歡迎光臨！午餐時間到～";
  if (hour < 17) return "下午好！來點東西補體力吧。";
  return "辛苦了，晚餐也交給我吧！";
}

export function shopkeeperLine(ctx: ShopkeeperContext): string {
  // 店家自己快要不接單了是店主該講的事，出現時不輪替其他台詞；團的收單由團主喊。
  const browsing = ctx.solo || !!ctx.notInRoom;
  if (!browsing && !ctx.roomClosed && ctx.deadlineAt !== null && ctx.deadlineAt > ctx.now) {
    const minutes = Math.ceil((ctx.deadlineAt - ctx.now) / 60000);
    if (minutes <= DEADLINE_REMIND_MINUTES) return `本店再 ${minutes} 分鐘就不接單囉！`;
  }

  const lines = [greeting(ctx.now)];
  if (ctx.solo) lines.push("喜歡的話，揪大家來開團吧！");
  else if (ctx.notInRoom) lines.push("這次沒揪到我們家，下次見！");
  else if (ctx.ordered.length === 1) lines.push(`${ctx.ordered[0].name}×${ctx.ordered[0].quantity}，馬上準備！`);
  else if (ctx.ordered.length > 1) lines.push(`${ctx.ordered.length} 樣餐點都記下了，馬上準備！`);
  const tip = !browsing && !ctx.roomClosed && !ctx.ordered.length ? "站到陳列台前按 Enter 點餐喔。" : "吃飽才有力氣，下午加油！";
  if (ctx.meals.length) {
    // 每輪完一圈台詞才換下一道推薦，避免推薦永遠落在同一道。
    const meal = ctx.meals[Math.floor(ctx.talk / (lines.length + 2)) % ctx.meals.length];
    lines.push(`推薦「${meal.name}」，NT$${meal.priceTwd}！`);
  } else {
    lines.push("今天的菜還在準備中喔。");
  }
  lines.push(tip);
  return lines[ctx.talk % lines.length];
}
