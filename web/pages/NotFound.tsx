import { link } from "../router";
import { MealImg, TopBar } from "../ui";

export function NotFound({ message = "找不到這個頁面" }: { message?: string }) {
  return (
    <div className="page">
      <TopBar />
      <div className="center">
        <div className="stack" style={{ justifyItems: "center" }}>
          <MealImg assetKey="meal-generic" alt="" />
          <h2 style={{ margin: 0 }}>{message}</h2>
          <p className="muted" style={{ margin: 0 }}>網址可能打錯了，或這個團已經不存在。</p>
          <a className="btn primary" {...link("/")}>
            回小鎮首頁
          </a>
        </div>
      </div>
    </div>
  );
}
