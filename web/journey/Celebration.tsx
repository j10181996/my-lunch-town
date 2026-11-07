import { useMemo, useState } from "react";
import type { LunchParty } from "../../shared/contracts";
import { Modal } from "../ui";
import { partyPhoto } from "./photo";

export function Celebration({ celebration, onClose }: {
  celebration: NonNullable<LunchParty["celebration"]>; onClose(): void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(celebration.members.length / 36);
  const photo = useMemo(() => partyPhoto({ ...celebration, members: celebration.members.slice(page * 36, (page + 1) * 36) }), [celebration, page]);
  return <Modal title="大家都選好了！一起留張合照" onClose={onClose}>
    <div className="party-confetti" aria-hidden="true">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ left: `${(i * 31) % 100}%`, animationDelay: `${(i % 8) * .12}s`, background: ["#d77862", "#edbe60", "#8ead7c", "#baa2ce"][i % 4] }} />)}</div>
    <p className="celebration-copy">♥ 午餐選好了，今天也要一起好好吃飯！</p>
    <img className="party-photo" src={photo} alt={`台中午休小旅行全團合照，第 ${page + 1} 頁，共 ${celebration.members.length} 位夥伴`} />
    {pages > 1 && <div className="row"><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button><span>{page + 1} / {pages}</span><button className="btn" disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>下一頁</button></div>}
    <small>合照使用完成當下的角色與暱稱。下載前請確認大家願意分享；手機可長按圖片儲存。</small>
    <div className="row"><a className="btn primary" href={photo} download={`taichung-lunch-town-${celebration.id}-${page + 1}.png`}>下載合照 PNG</a><button className="btn" onClick={onClose}>繼續逛小鎮</button></div>
    <small>選餐完成不會自動收單；仍由團主確認送出。</small>
  </Modal>;
}
