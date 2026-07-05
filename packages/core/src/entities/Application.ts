export const AUTH_TYPES = ["OAUTH", "BASIC", "API_KEY", "NONE"] as const;
export type AuthType = typeof AUTH_TYPES[number];
export const DEFAULT_AUTH_TYPE: AuthType = "NONE";

export const APPLICATION_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
export const DEFAULT_APPLICATION_STATUS: ApplicationStatus = "ACTIVE";

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
  authType: AuthType;
  status: ApplicationStatus;
  loginSuccessUrlPattern?: string;
  loginSuccessCookieName?: string;
  sessionInjectionRules?: string;
  userIdCookieName?: string;
  sessionCaptureHeaders?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const USER_ID_FALLBACK_NAMES = ["user_id", "userid", "username"];

/**
 * Checks if a given header key matches the configured capture headers pattern (comma-separated, supporting wildcards).
 * If no pattern is provided, it defaults to standard "authorization" and "x-*" headers.
 */
export function matchesCaptureHeaders(headerName: string, captureHeadersPattern?: string): boolean {
  const pattern = captureHeadersPattern || "authorization,x-*";
  const lowerHeader = headerName.toLowerCase();
  
  return pattern
    .split(",")
    .map(p => p.trim().toLowerCase())
    .some(p => {
      if (p.endsWith("*")) {
        return lowerHeader.startsWith(p.slice(0, -1));
      }
      return lowerHeader === p;
    });
}
