/** 回傳給瀏覽器的最小登入狀態；權限一律由伺服器重新判定。 */
export interface SessionInfo {
  authenticated: boolean;
  user: { id: string; email: string; name: string } | null;
  member: boolean;
  admin: boolean;
  /** 只提供可管理店家的 ID，不外洩其他店家或邀請資料。 */
  storeIds: string[];
  signInPath: string;
  signOutPath: string;
}

export interface StoreInvite {
  id: string;
  storeId: string;
  targetUserId: string;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

/** 建立時才回傳明碼 token；後續列表絕不再回傳。 */
export interface CreatedStoreInvite extends StoreInvite {
  token: string;
}
