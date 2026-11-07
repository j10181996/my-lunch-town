/** 業務 image 的冪等升級，Node 與 Worker 共用；只保存 metadata，不保存原照片。 */
export const MEAL_IMAGES_SCHEMA = `CREATE TABLE IF NOT EXISTS meal_images (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  object_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;
