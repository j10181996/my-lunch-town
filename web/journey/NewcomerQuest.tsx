import { useState } from "react";
import type { AchievementId } from "../game/collection";

const STEPS = [
  { id: "visit", icon: "🚪", name: "逛一家店", hint: "進店看看今天吃什麼", action: "帶我逛店" },
  { id: "friend", icon: "🐾", name: "摸摸小動物", hint: "回街上，靠近動物按摸摸", action: "回街上找動物" },
  { id: "order", icon: "🍱", name: "選一份午餐", hint: "點餐點圖案，或菜單的＋1", action: "帶我點餐" },
] as const;
export function NewcomerQuest({ achievements, onGuide }: {
  achievements: AchievementId[]; onGuide(step: "visit" | "friend" | "order"): void;
}) {
  const [open, setOpen] = useState(false);
  const count = STEPS.filter((step) => achievements.includes(step.id)).length;
  return <div className="newcomer-quest">
    <button className="quest-toggle" aria-expanded={open} aria-controls="newcomer-steps" onClick={() => setOpen(!open)}>
      <span>{count === 3 ? "🌟 午休冒險完成" : "🗺️ 新手任務"}</span><small>{count} / 3 {open ? "▲" : "▼"}</small>
    </button>
    {open && <section id="newcomer-steps" aria-label="新手任務" className="quest-steps">
      <strong>你的台中午休小旅行</strong>
      <p>走走、交朋友，再選今天的午餐。</p>
      {STEPS.map((step) => <div className={achievements.includes(step.id) ? "quest-done" : ""} key={step.id}>
        <strong>{achievements.includes(step.id) ? "✓" : step.icon} {step.name}</strong>
        <small>{achievements.includes(step.id) ? "已完成" : step.hint}</small>
        {!achievements.includes(step.id) && <button className="btn small" onClick={() => { onGuide(step.id); setOpen(false); }}>{step.action}</button>}
      </div>)}
      <p>{count === 3 ? "三站都完成了！選好午餐後，和大家一起合照。" : "任務可以自由完成，不影響點餐。"}</p>
      <button className="btn small" onClick={() => setOpen(false)}>收起任務</button>
    </section>}
  </div>;
}
