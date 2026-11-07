import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, MEAL_IMAGE_SIZE, quantizeMealPixels } from "../../shared/meal-images";

/** 先讀檔頭限制解碼尺寸，只接受 PNG／JPEG，轉成單張靜態圖片。 */
export function photoDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === "image/png" && bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    && String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR") {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 3 < bytes.length) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 218 || marker === 217) break;
      if (p + 2 > bytes.length) break;
      const size = view.getUint16(p);
      if (size < 2 || p + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 7) {
        height = view.getUint16(p + 3); width = view.getUint16(p + 5); break;
      }
      p += size;
    }
  }
  if (!width || !height) throw new Error("照片格式不符或檔案損壞，請選擇 PNG 或 JPEG");
  if (width > 8192 || height > 8192 || width * height > MAX_PHOTO_PIXELS) throw new Error("照片尺寸過大，請使用 1600 萬像素以下、單邊不超過 8192 像素的照片");
  return { width, height };
}
export async function prepareMealPhoto(file: File, fit: "cover" | "contain") {
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("請選擇 PNG 或 JPEG 照片");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("照片不能超過 5 MB");
  photoDimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("無法讀取這張照片，請換一張 PNG 或 JPEG"); });
  try {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = MEAL_IMAGE_SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const ratio = (fit === "cover" ? Math.max : Math.min)(MEAL_IMAGE_SIZE / bitmap.width, MEAL_IMAGE_SIZE / bitmap.height);
    const width = bitmap.width * ratio, height = bitmap.height * ratio;
    ctx.drawImage(bitmap, (MEAL_IMAGE_SIZE - width) / 2, (MEAL_IMAGE_SIZE - height) / 2, width, height);
    const pixels = quantizeMealPixels(ctx.getImageData(0, 0, MEAL_IMAGE_SIZE, MEAL_IMAGE_SIZE).data);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), MEAL_IMAGE_SIZE, MEAL_IMAGE_SIZE), 0, 0);
    return { pixels: Array.from(pixels), preview: canvas.toDataURL("image/png") };
  } finally { bitmap.close(); }
}
