/** 午餐小鎮 v0.1 建議共用契約。型別與整合提案，尚未提供執行實作。 */
export type Id = string;
export type SceneId = "street" | `shop:${string}`;
export type Direction = "up" | "down" | "left" | "right";
export type Role = "owner" | "participant";
export type RoomStatus = "open" | "closed";

export interface Point { x: number; y: number }
export interface Store {
  id: Id;
  name: string;
  sceneId: `shop:${string}`;
  door: Point;
  interiorAssetKey: string;
}
export interface Meal {
  id: Id;
  storeId: Id;
  name: string;
  priceTwd: number; // 非負整數，伺服器驗證
  imageAssetKey: string;
  available: boolean;
  tags: string[];
}
export interface Catalog {
  catalogVersion: string;
  currency: "TWD";
  isSample: boolean;
  stores: Store[];
  meals: Meal[];
}
export interface Room {
  id: Id;
  title: string;
  status: RoomStatus;
  catalogVersion: string;
  revision: number; // 持久化狀態變更遞增；角色移動不遞增
}
export interface Member {
  id: Id;
  roomId: Id;
  nickname: string;
  avatarId: string;
  role: Role;
}
export interface OrderItem {
  roomId: Id;
  memberId: Id;
  mealId: Id;
  quantity: number; // 正整數，數量零時刪除該列
  unitPriceTwd: number;
}
export interface MealTotal {
  mealId: Id;
  name: string;
  unitPriceTwd: number;
  quantity: number;
  subtotalTwd: number;
}
export interface StoreTotal {
  storeId: Id;
  name: string;
  meals: MealTotal[];
  totalQuantity: number;
  totalTwd: number;
}
export interface RoomSnapshot {
  room: Room;
  me: Member;
  members: Array<Pick<Member, "id" | "nickname" | "avatarId">>;
  catalog: Catalog;
  myItems: OrderItem[];
  myTotalTwd: number;
  myTotalQuantity: number;
  storeTotals: StoreTotal[];
  totalQuantity: number;
  totalTwd: number;
  // 不含工作階段憑證，也不含其他人的逐筆訂單
}
export interface OwnerSummary {
  roomId: Id;
  status: RoomStatus;
  revision: number;
  stores: StoreTotal[];
  people: Array<{
    memberId: Id;
    nickname: string;
    items: OrderItem[];
    totalQuantity: number;
    totalTwd: number;
  }>;
  totalQuantity: number;
  totalTwd: number;
}
export interface CreateRoomInput {
  title: string;
  nickname: string;
  requestId: string; // 同一工作階段的開團重試使用相同 ID
}
export interface JoinInput { nickname: string; avatarId: string }
export interface OrderDeltaInput {
  mealId: Id;
  delta: 1 | -1;
  requestId: string; // 一次有效操作一個 UUID；逾時重試沿用
}
export interface OrderAck {
  requestId: string;
  mealId: Id;
  quantity: number; // 允許零，代表已移除
  myTotalTwd: number;
  revision: number;
}
export type ErrorCode =
  | "INVALID_INPUT" | "SESSION_REQUIRED" | "NOT_ALLOWED"
  | "ROOM_NOT_FOUND" | "MEAL_NOT_FOUND" | "ROOM_CLOSED"
  | "REQUEST_ID_CONFLICT" | "RETRY_LATER";
export interface ApiError {
  code: ErrorCode;
  message: string;
  requestId?: string;
}
export interface PlayerPresence {
  memberId: Id;
  sceneId: SceneId;
  x: number; // 0..1，場景內邏輯座標
  y: number; // 0..1
  direction: Direction;
  seq: number; // 在同一次連線內遞增；新連線重置
}
export interface MoveInput extends Omit<PlayerPresence, "memberId"> {}
export interface RoomChanged { roomId: Id; revision: number }
export interface PresenceSnapshot { roomId: Id; players: PlayerPresence[] }

/** 身分由 adapter 的工作階段處理；禁止由 UI 指定他人的 memberId。 */
export interface RoomGateway {
  createRoom(input: CreateRoomInput): Promise<{
    invitePath: string;
    snapshot: RoomSnapshot;
  }>;
  joinRoom(roomId: Id, input: JoinInput): Promise<RoomSnapshot>;
  getSnapshot(roomId: Id): Promise<RoomSnapshot>;
  changeQuantity(roomId: Id, input: OrderDeltaInput): Promise<OrderAck>;
  closeRoom(roomId: Id, requestId: string): Promise<RoomSnapshot>;
  getOwnerSummary(roomId: Id): Promise<OwnerSummary>;
  exportOrder(roomId: Id): Promise<string>;
  /** 呼叫後先連線並驗證房間；重連時呼叫 onReconnect，UI 重取 snapshot。 */
  subscribe(roomId: Id, handlers: {
    onChanged(event: RoomChanged): void;
    onPresence(event: PresenceSnapshot): void;
    onReconnect(): void;
    onDisconnect(): void;
  }): () => void;
  move(roomId: Id, input: MoveInput): void;
}
