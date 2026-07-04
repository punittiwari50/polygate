/**
 * Represents an entry in the system audit log for operations tracing.
 */
export interface AuditLog {
  id?: number;
  appId?: number;
  endpointId?: number;
  action: 'LOGIN' | 'LOGOUT' | 'VERIFY' | 'PROXY' | 'SEED' | 'ORDER_CREATE' | 'ORDER_READ' | 'ORDER_UPDATE' | 'ORDER_DELETE' | 'ORDER_LIST';
  actionId?: number;
  personId?: number;
  identityId?: number;
  sessionId?: number;
  correlationId?: string;
  statusCode?: number;
  executedAt?: Date;
  detail?: string;
}
