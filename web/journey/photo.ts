import type { LunchParty } from "../../shared/contracts";
import { characterFrames } from "../art/characters";

/** 僅使用本機 Canvas 與原創像素角色，不使用相機、上傳或遠端圖檔。 */
export function partyPhoto(celebration: NonNullable<LunchParty["celebration"]>): string {
  const members = celebration.members;
  const columns = Math.min(6, Math.max(1, members.length));
  const rows = Math.ceil(members.length / columns);
  // 合照介面每頁最多 36 人，限制手機圖片記憶體用量。
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 390 + rows * 210;
  const c = canvas.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#faf0d8"; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#e9b76a"; c.fillRect(24, 24, 1152, canvas.height - 48);
  c.fillStyle = "#fdf6e7"; c.fillRect(36, 36, 1128, canvas.height - 72);
  // 以綠帶、暖色街景與太陽餅造型的太陽呈現午休紀念卡。
  c.fillStyle = "#f2d08a"; c.beginPath(); c.arc(1040, 117, 54, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#d9a257"; c.lineWidth = 5; c.beginPath(); c.arc(1040, 117, 34, .4, 5.7); c.stroke();
  for (let i = 0; i < 11; i++) {
    c.fillStyle = i % 2 ? "#a3ba82" : "#829f70";
    c.fillRect(50 + i * 108, 230, 44, 65); c.fillRect(35 + i * 108, 218, 74, 35);
  }
  c.textAlign = "center"; c.fillStyle = "#60442f";
  c.font = 'bold 52px system-ui, sans-serif'; c.fillText("台中午休小旅行", 600, 120);
  c.font = '26px system-ui, sans-serif'; c.fillText("TAICHUNG · LUNCH TOWN", 600, 170);
  c.fillStyle = "#fff2d4"; c.fillRect(50, 300, 1100, rows * 210 + 35);
  members.forEach((m, i) => {
    const row = Math.floor(i / columns), inRow = Math.min(columns, members.length - row * columns);
    const x = 600 + (i % columns - (inRow - 1) / 2) * (1040 / columns);
    const y = 325 + row * 210;
    c.fillStyle = "#e5d2ad"; c.beginPath(); c.ellipse(x, y + 130, 47, 11, 0, 0, 2 * Math.PI); c.fill();
    c.drawImage(characterFrames(m.avatarId).down[0], x - 48, y + 4, 96, 128);
    c.fillStyle = "#cc725c"; c.font = '28px system-ui, sans-serif'; c.fillText("♥", x + 42, y + 20);
    c.fillStyle = "#60442f"; c.font = 'bold 23px system-ui, sans-serif';
    const max = 1000 / columns;
    let name = m.nickname;
    while (name.length > 1 && c.measureText(name).width > max) name = name.slice(0, -2) + "…";
    c.fillText(name, x, y + 173);
  });
  c.fillStyle = "#6a7955"; c.font = '24px system-ui, sans-serif';
  c.fillText(`一起選午餐的我們 · ${members.length} 人同行`, 600, canvas.height - 52);
  return canvas.toDataURL("image/png");
}
