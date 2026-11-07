/**
 * 付款提醒獨立成表：Node 啟動遷移與 Sites 讀取舊快照時都以 IF NOT EXISTS 補齊，
 * 不需要改動 rooms 欄位。
 */
export const PAYMENT_REMINDER_SCHEMA = `CREATE TABLE IF NOT EXISTS payment_reminders (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  reminded_at INTEGER NOT NULL
)`;
