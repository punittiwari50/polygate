/**
 * Represents a downstream application target behind the PolyGate gateway.
 */
export interface Application {
  id?: number;
  appKey: string;
  displayName: string;
  baseUrl: string;
  loginUrl?: string;
  domainId?: number;
  authType: 'OAUTH' | 'BASIC' | 'API_KEY' | 'NONE';
  status: 'ACTIVE' | 'DISABLED';
  loginSuccessUrlPattern?: string;
  loginSuccessCookieName?: string;
  sessionInjectionRules?: string;
  userIdCookieName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const USER_ID_FALLBACK_NAMES = ["user_id", "userid", "username"];
