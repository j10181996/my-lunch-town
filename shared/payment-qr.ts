import type { PaymentMethod } from "./contracts";

/** TWQR 轉帳帳號固定 16 碼，不足左補 0。 */
const TWQR_ACCOUNT_DIGITS = 16;

/**
 * 產生財金公司「台灣Pay／TWQR」共通規格的個人轉帳字串，網銀與台灣Pay App 掃描後會帶入
 * 轉入行、轉入帳號與金額（D1 含兩位小數、不含小數點，100 元為 10000）。
 * 帳號去掉 - 後超過 16 碼無法放入規格欄位，回傳 null，畫面只顯示文字帳號。
 */
export function twqrTransferPayload(
  method: Extract<PaymentMethod, { type: "bank" }>,
  amountTwd?: number,
): string | null {
  const digits = method.account.replace(/-/g, "");
  if (!/^\d{3}$/.test(method.bankCode) || !/^\d+$/.test(digits) || digits.length > TWQR_ACCOUNT_DIGITS) return null;
  const params = [
    `D5=${method.bankCode}`,
    `D6=${digits.padStart(TWQR_ACCOUNT_DIGITS, "0")}`,
    "D10=901",
  ];
  if (amountTwd !== undefined && Number.isSafeInteger(amountTwd) && amountTwd > 0) {
    params.push(`D1=${amountTwd * 100}`);
  }
  return `TWQRP://${encodeURIComponent("個人轉帳")}/158/02/V1?${params.join("&")}`;
}

/** 每種收款方式掃碼後要帶入的內容；沒有可用格式時回傳 null。 */
export function paymentQrPayload(method: PaymentMethod, amountTwd?: number): string | null {
  switch (method.type) {
    case "bank": return twqrTransferPayload(method, amountTwd);
    case "linepay":
    case "jkopay": return method.link || null;
    default: return null;
  }
}
