import { deflateSync } from "node:zlib";
import { MEAL_IMAGE_SIZE } from "../../shared/meal-images";

function chunk(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(new TextEncoder().encode(name), 4); out.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, -4)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  new DataView(out.buffer).setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}
/** 只編碼固定尺寸 RGBA，沒有處理任意壓縮圖片的資源風險。 */
export function encodeMealPng(pixels: Uint8Array): Uint8Array {
  const size = MEAL_IMAGE_SIZE;
  if (pixels.length !== size * size * 4) throw new Error("圖片尺寸錯誤");
  const scanlines = new Uint8Array(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) scanlines.set(pixels.subarray(row * size * 4, (row + 1) * size * 4), row * (size * 4 + 1) + 1);
  const ihdr = new Uint8Array(13); const view = new DataView(ihdr.buffer);
  view.setUint32(0, size); view.setUint32(4, size); ihdr[8] = 8; ihdr[9] = 6;
  const pieces = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const piece of pieces) { out.set(piece, offset); offset += piece.length; }
  return out;
}
