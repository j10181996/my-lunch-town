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
/** 小鎮上不在本團的店面：可以進店看菜單，但不能點餐（#78）。 */
export interface StreetStore {
  id: Id;
  name: string;
  styleKey: string;
  lotIndex: number;
  /** 目前供應中的餐點，只供瀏覽；舊版伺服器可能沒有此欄位。 */
  meals?: Meal[];
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
  members: Array<Pick<Member, "id" | "nickname" | "avatarId" | "role">>;
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
  badge?: import("./social").BadgeId;
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
  address?: string;
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
  store: { id: Id; name: string; styleKey: string; status: StoreStatus; address?: string } | null;
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
  address?: string;
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
  people: Array<{ nickname: string; items: StoreOrderPersonItem[]; totalTwd: number }>;
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

/**
 * 真實經緯度（WGS84）。新團以送餐位置與店家位置的球面直線距離判斷外送；
 * 舊團只有遊戲街區座標 deliveryPoint，沿用舊的像素換算直到收單。
 */
export interface GeoPoint { lat: number; lng: number }
export interface Room { deliveryLocation?: GeoPoint | null }
export interface CreateRoomInput { deliveryLocation?: GeoPoint }
/** 開團時與外送規則一起凍結。 */
export interface Store { location?: GeoPoint | null }
export interface StoreProfile { location: GeoPoint | null }
/** address 選填：一併更新店家地址（地址推算座標時使用）。 */
export interface SetStoreLocationInput { location: GeoPoint | null; address?: string }
export interface StoreAdminGateway {
  setLocation(storeId: Id, location: GeoPoint | null, address?: string): Promise<StoreProfile>;
}
/** 地址推算座標的結果。house：門牌吻合；street：只找到路段或巷弄；area：只找到大略區域。 */
export interface GeocodeResult {
  location: GeoPoint;
  precision: "house" | "street" | "area";
  /** 地圖資料中的完整地名，給使用者確認 */
  label: string;
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

export interface StoreAdminGateway {
  uploadImage(storeId: Id, pixels: number[]): Promise<{ imageAssetKey: string }>;
}
/** 散步模式（#44）：即時菜單中目前不收單的店，街景畫成休息中。 */
export interface Store { resting?: boolean }

/** 截止時間（#15）：毫秒 epoch；null 表示不設截止。時間到由伺服器自動收單。 */
export interface Room { deadlineAt?: number | null }
export interface CreateRoomInput { deadlineAt?: number | null }

/** 我的團歷史（#17）：首頁列出我開過與參加過的團。只含自己的金額。 */
export interface MyRoomSummary {
  id: Id;
  title: string;
  status: RoomStatus;
  role: Role;
  createdAt: number;
  closedAt: number | null;
  memberCount: number;
  myTotalTwd: number;
  /** 當時的暱稱與角色；「再揪一次」沿用。 */
  nickname: string;
  avatarId: string;
  deliveryPoint: Point | null;
  deliveryLocation: GeoPoint | null;
  /** 團員本來就看得到送餐地址，「再揪一次」一併沿用。 */
  deliveryAddress: string | null;
  stores: Array<{ id: Id; name: string }>;
}

/**
 * 餐點選項與個人備註（#14）。選項群組隨餐點凍結進團；點餐明細的鍵是「餐點 + 選項組合 + 備註」。
 * min／max 是可選數量：min ≥ 1 為必選，max 1 為單選。選項識別碼由伺服器依位置產生。
 */
export interface MealOptionChoice { id: Id; name: string; priceTwd: number }
export interface MealOptionGroup { id: Id; name: string; min: number; max: number; choices: MealOptionChoice[] }
export interface Meal { options?: MealOptionGroup[] }
export interface AdminMeal { options: MealOptionGroup[] }
/** 送出時選項與群組的 id 可省略。 */
export interface MealInput { options?: MealOptionGroup[] }
export interface OrderItem {
  /** 依菜單順序；沒有選項為空陣列。 */
  choiceIds: Id[];
  /** 個人備註，空字串表示沒有。 */
  note: string;
  /** 明細識別鍵，見 shared/meal-options.ts 的 lineKeyOf。 */
  lineKey: string;
}
/** 店家彙總依「餐點 + 選項組合」分列；備註只出現在每人明細。舊訂單快照沒有這些欄位。 */
export interface MealTotal { choiceIds?: Id[]; optionLabel?: string; lineKey?: string }
/** 都省略時等同升級前的請求（沿用原本的去重 digest）。 */
export interface OrderDeltaInput { choiceIds?: Id[]; note?: string }
export interface OrderAck { lineKey?: string; choiceIds?: Id[]; note?: string }
/** 店家訂單的每人明細；options 是選項文字。舊快照沒有 options／note。 */
export interface StoreOrderPersonItem { name: string; quantity: number; options?: string; note?: string }
/** 吃完給店家按讚（#92）。 */
export interface RoomSnapshot { likedStoreIds?: Id[] }
export interface StoreLikes {
  total: number;
  last7Days: number;
  /** 最近幾筆：只有時間與團名，不顯示是誰按的。 */
  recent: Array<{ at: number; roomTitle: string }>;
}
export interface StoreAdminGateway { getLikes(storeId: Id): Promise<StoreLikes> }
