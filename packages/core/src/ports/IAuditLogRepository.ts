import { AuditLog } from "../entities/AuditLog.js";

export interface IAuditLogRepository {
  save(log: AuditLog): Promise<AuditLog>;
}
