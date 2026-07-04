import { injectable, inject } from "tsyringe";
import { IAuditLogRepository } from "../ports/IAuditLogRepository.js";
import { AuditLog } from "../entities/AuditLog.js";

@injectable()
export class AuditLogService {
  constructor(
    @inject("IAuditLogRepository")
    private auditLogRepo: IAuditLogRepository
  ) {}

  /**
   * Records an action in the audit log database.
   */
  public async logAction(
    action: 'LOGIN' | 'LOGOUT' | 'VERIFY' | 'PROXY' | 'SEED',
    params: {
      appId?: number;
      endpointId?: number;
      statusCode?: number;
      detail?: string;
    }
  ): Promise<AuditLog> {
    const log: AuditLog = {
      action,
      appId: params.appId,
      endpointId: params.endpointId,
      statusCode: params.statusCode,
      detail: params.detail,
      executedAt: new Date()
    };
    return this.auditLogRepo.save(log);
  }
}
