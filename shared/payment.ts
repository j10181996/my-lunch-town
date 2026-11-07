import type { PaymentInfo, PaymentMethod } from "./contracts";

/** 純函式；API 邊界將驗證錯誤轉成 err.invalid。 */
export function validatePaymentInfo(input: unknown): PaymentInfo {
  const invalid = (message: string): never => {
    throw Object.assign(new Error(message), { code: "INVALID_INPUT" as const });
  };
  const field = (value: unknown, label: string, min: number, max: number): string => {
    if (typeof value !== "string") return invalid(`${label}格式錯誤`);
    const text = value.trim();
    if (text.length < min || text.length > max) return invalid(`${label}須為 ${min} 至 ${max} 字`);
    return text;
  };
  if (!input || typeof input !== "object") return invalid("請提供收款資料");
  const info = input as PaymentInfo;
  if (!Array.isArray(info.methods) || info.methods.length < 1 || info.methods.length > 4) {
    return invalid("收款方式須為 1 至 4 個");
  }
  const methods = info.methods.map((method): PaymentMethod => {
    if (!method || typeof method !== "object") return invalid("收款方式格式錯誤");
    switch (method.type) {
      case "bank": {
        const bankCode = field(method.bankCode, "銀行代碼", 3, 3);
        const account = field(method.account, "帳號", 6, 20);
        if (!/^\d{3}$/.test(bankCode)) return invalid("銀行代碼須為 3 位數字");
        if (!/^[\d-]+$/.test(account)) return invalid("帳號只允許數字與 -");
        return {
          type: "bank",
          bankCode,
          account,
          holder: field(method.holder, "戶名", 1, 20),
        };
      }
      case "linepay":
      case "jkopay": {
        const id = field(method.id, "收款 ID", 1, 40);
        const link = method.link === undefined ? "" : field(method.link, "收款連結", 0, 300);
        if (!link) return { type: method.type, id };
        if (!isHttpsUrl(link)) return invalid("收款連結須為 https:// 開頭的網址");
        return { type: method.type, id, link };
      }
      case "cash": return {
        type: "cash",
        note: field(method.note, "現金說明", 0, 40),
      };
      case "other": return {
        type: "other",
        text: field(method.text, "收款說明", 1, 60),
      };
      default: return invalid("不支援的收款方式");
    }
  });
  return {
    methods,
    note: field(info.note, "備註", 0, 100),
  };
}

function isHttpsUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}
