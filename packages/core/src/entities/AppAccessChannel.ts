/**
 * Represents a multi-audience access channel for an application (e.g. CUSTOMER, BROKER, PARTNER, INTERNAL).
 */
export interface AppAccessChannel {
  id?: number;
  appId: number;
  channelType: 'CUSTOMER' | 'BROKER' | 'PARTNER' | 'INTERNAL';
  baseUrl: string;
  loginUrl?: string;
  logoutUrl?: string;
  loginSuccessUrlPattern?: string;
  loginSuccessCookieName?: string;
  sessionInjectionRules?: string;
  userIdCookieName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
