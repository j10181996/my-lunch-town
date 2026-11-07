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
/** 小鎮上不在本團的店面：只用來畫街景，不能進店點餐。 */
export interface StreetStore {
  id: Id;
  name: string;
  styleKey: string;
  lotIndex: number;
}
export interface LunchParty {
  readyMemberIds: string[];
  celebration: { id: number; members: Array<Pick<Member, "id" | "nickname" | "avatarId">> } | null;
}
export interface RoomSnapshot {
  lunchParty?: LunchParty;
  socialEnabled?: boolean;
  /** 街上其他店面（不在本團），舊版伺服器可能沒有此欄位。 */
  streetStores?: StreetStore[];
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
  people: OwnerSummaryPerson[];
  totalQuantity: number;
  totalTwd: number;
}
export interface CreateRoomInput {
  title: string;
  nickname: string;
  requestId: string; // 同一工作階段的開團重試使用相同 ID
  avatarId?: string; // 團長角色；省略或無效時用預設角色
  storeIds?: Id[]; // 本團的店家，至少一家；型別保留選填只為了相容升級前的重試請求
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
  accessory?: "none" | "flower" | "leaf" | "cap";
  badge?: "visit" | "order" | "friend" | "collect";
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

/* ===== 以下為「我們的版本」新增，原有型別一律不改 ===== */

/** Store 補充欄位（宣告合併，選填）：店面風格與街區地段。door 由地段推得。 */
export interface Store {
  styleKey?: string;
  lotIndex?: number;
}

export type StoreStatus = "open" | "resting";

/** 加入前可讀的房間公開資訊（不需成員身分）。 */
export interface RoomPublicInfo {
  id: Id;
  title: string;
  status: RoomStatus;
  memberCount: number;
}

export interface TownLot {
  index: number;
  store: { id: Id; name: string; styleKey: string; status: StoreStatus } | null;
}

export interface AdminMeal {
  id: Id;
  name: string;
  priceTwd: number;
  imageAssetKey: string;
  available: boolean;
  tags: string[];
  sortOrder: number;
}

export interface StoreProfile {
  id: Id;
  name: string;
  styleKey: string;
  lotIndex: number;
  status: StoreStatus;
  isSample: boolean;
  meals: AdminMeal[];
  /** 仍在進行中、且凍結了本店菜單的團數；修改只影響之後開的團。 */
  activeRoomCount: number;
}

export interface CreateStoreInput {
  name: string;
  styleKey: string;
  lotIndex: number;
  requestId: string;
}
export interface CreateStoreResult {
  adminPath: string;
  profile: StoreProfile;
  /** 只在第一次建立時回傳；伺服器只保存雜湊。重試回 null。 */
  manageKey: string | null;
}
export interface UpdateStoreInput {
  name?: string;
  styleKey?: string;
  lotIndex?: number;
}
export interface MealInput {
  name: string;
  priceTwd: number;
  imageAssetKey: string;
  available: boolean;
  tags: string[];
}

export interface StoreAdminGateway {
  getTown(): Promise<TownLot[]>;
  myStores(): Promise<StoreProfile[]>;
  createStore(input: CreateStoreInput): Promise<CreateStoreResult>;
  claimStore(manageKey: string): Promise<StoreProfile>;
  getStore(storeId: Id): Promise<StoreProfile>;
  updateStore(storeId: Id, input: UpdateStoreInput): Promise<StoreProfile>;
  setStatus(storeId: Id, status: StoreStatus): Promise<StoreProfile>;
  addMeal(storeId: Id, input: MealInput): Promise<StoreProfile>;
  updateMeal(storeId: Id, mealId: Id, input: Partial<MealInput>): Promise<StoreProfile>;
  moveMeal(storeId: Id, mealId: Id, direction: "up" | "down"): Promise<StoreProfile>;
  deleteMeal(storeId: Id, mealId: Id): Promise<StoreProfile>;
}

/** 點餐泡泡（加分功能）：+1 成功後廣播給同房間。 */
export interface PlayerBubble { memberId: Id; text: string }

/** 收單後的店家訂單，內容固定，狀態由目前店家擁有者更新。 */
export type StoreOrderStatus = "sent" | "accepted" | "rejected" | "preparing" | "ready";
export interface RoomStoreOrder {
  storeId: Id;
  storeName: string;
  status: StoreOrderStatus;
  rejectReason: string | null;
  totalQuantity: number;
  totalTwd: number;
  updatedAt: number;
}
export interface StoreOrder extends RoomStoreOrder {
  id: Id;
  roomId: Id;
  roomTitle: string;
  ownerNickname: string;
  items: MealTotal[];
  people: Array<{ nickname: string; items: Array<{ name: string; quantity: number }>; totalTwd: number }>;
  createdAt: number;
}
export interface UpdateStoreOrderInput { status: StoreOrderStatus; reason?: string }
export interface RoomSnapshot { storeOrders?: RoomStoreOrder[] }
export interface StoreAdminGateway {
  listOrders(storeId: Id): Promise<StoreOrder[]>;
  updateOrderStatus(storeId: Id, orderId: Id, input: UpdateStoreOrderInput): Promise<StoreOrder>;
  subscribeOrders(storeId: Id, onChanged: () => void): () => void;
}

/** 外送規則於開團時與菜單一起凍結。 */
export type DeliveryRules = {
  enabled: boolean;
  tiers: Array<{ maxKm: number; minTwd: number }>;
};
/** 送餐地址（選填）上限字數；只給團員與外送單的店家看，自取單不帶地址。 */
export const DELIVERY_ADDRESS_MAX = 100;
export interface Room { deliveryPoint?: Point | null; deliveryAddress?: string | null }
export interface Store { delivery?: DeliveryRules | null }
export interface StoreProfile { delivery: DeliveryRules | null }
export interface CreateRoomInput { deliveryPoint?: Point; deliveryAddress?: string }
export interface StoreOrder { deliveryAddress: string | null }
export interface RoomStoreOrder {
  fulfillment: "delivery" | "pickup";
  distanceKm: number | null;
  deliveryMinTwd: number | null;
}
export interface StoreAdminGateway {
  setDelivery(storeId: Id, rules: DeliveryRules): Promise<StoreProfile>;
}

export interface OwnerSummaryPerson {
  memberId: Id;
  nickname: string;
  items: OrderItem[];
  totalQuantity: number;
  totalTwd: number;
}

export type PaymentMethod =
  | {
    type: "bank";
    bankCode: string;
    account: string;
    holder: string;
  }
  | {
    type: "linepay";
    id: string;
    /** 團主從 App 複製的收款連結；有填才產生 QR code。 */
    link?: string;
  }
  | {
    type: "jkopay";
    id: string;
    link?: string;
  }
  | {
    type: "cash";
    note: string;
  }
  | {
    type: "other";
    text: string;
  };
export interface PaymentInfo {
  methods: PaymentMethod[];
  note: string;
}
export type PaymentStatus = "unpaid" | "reported" | "confirmed";
export interface RoomSnapshot {
  payment?: {
    info: PaymentInfo;
    sentAt: number | null;
    ownerNickname: string;
    /** 僅團主可見：最近一次提醒未付款的時間。 */
    remindedAt?: number | null;
  } | null;
  myPayment?: {
    amountTwd: number;
    status: PaymentStatus;
    /** 僅在仍未付款時出現：團主最近一次提醒的時間。 */
    remindedAt?: number | null;
  } | null;
}
export interface OwnerSummaryPerson {
  paymentStatus?: PaymentStatus | null;
}
export interface OwnerSummary {
  paymentProgress?: {
    paidCount: number;
    totalCount: number;
    paidTwd: number;
    totalTwd: number;
  };
}

/** Sunday=0. End before start means the next day; intervals are [open, close). */
export interface StoreHours { weekly: Array<Array<{ open: string; close: string }>>; cutoff: string | null }
export interface StoreProfile { hours?: StoreHours | null }
export interface Store { orderDeadlineAt?: number | null }
export interface StoreAdminGateway { setHours(storeId: Id, hours: StoreHours | null): Promise<StoreProfile> }

export interface ManagementStore {
  id: Id;
  name: string;
  styleKey: string;
  lotIndex: number;
  manualStatus: StoreStatus;
  accepting: boolean;
  hours: StoreHours | null;
  canViewDetails: boolean;
  mealCount: number | null;
  availableMealCount: number | null;
  activeRoomCount: number | null;
  providesDelivery: boolean | null;
  managed: boolean | null;
  managePath: string;
}
export interface ManagementStoreList { scope: "all"; stores: ManagementStore[] }

/** 散步模式（#44）：即時菜單中目前不收單的店，街景畫成休息中。 */
export interface Store { resting?: boolean }
