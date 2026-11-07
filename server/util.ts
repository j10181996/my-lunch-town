import { randomBytes } from "node:crypto";
import { err } from "./db";

export { hashKey } from "./db";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function randomId(len = 10): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 字數以 Unicode 字元計，中文一字算一。 */
export function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") throw err.invalid(`${field}必須是文字`);
  const v = value.trim();
  const len = [...v].length;
  if (len < min || len > max) throw err.invalid(`${field}需為 ${min} 至 ${max} 個字`);
  return v;
}

export function requestId(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 64) {
    throw err.invalid("requestId 格式錯誤");
  }
  return value;
}

export function intInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw err.invalid(`${field}需為 ${min} 至 ${max} 的整數`);
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, field: string, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw err.invalid(`${field}不在可選範圍`);
  return value as T;
}
