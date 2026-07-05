import {
  Application,
  SessionCredential,
  EndpointDefinition,
  AuditLog,
  IAppRepository,
  ISessionRepository,
  IEndpointRepository,
  IAuditLogRepository,
  AUTH_TYPES,
  APPLICATION_STATUSES
} from "@polygate/core";

export class MemoryAppRepository implements IAppRepository {
  private static apps = new Map<number, Application>();
  private static idCounter = 1;

  public async findByKey(appKey: string): Promise<Application | null> {
    for (const app of MemoryAppRepository.apps.values()) {
      if (app.appKey.toLowerCase() === appKey.toLowerCase()) {
        return { ...app };
      }
    }
    return null;
  }

  public async list(): Promise<Application[]> {
    return Array.from(MemoryAppRepository.apps.values()).map(app => ({ ...app }));
  }

  public async upsert(app: Application): Promise<Application> {
    // Validate constraint
    if (app.authType && !(AUTH_TYPES as readonly string[]).includes(app.authType)) {
      throw new Error(`Invalid authType: ${app.authType}`);
    }
    if (app.status && !(APPLICATION_STATUSES as readonly string[]).includes(app.status)) {
      throw new Error(`Invalid status: ${app.status}`);
    }

    const existing = await this.findByKey(app.appKey);
    if (existing && existing.id) {
      const updated: Application = {
        ...existing,
        ...app,
        id: existing.id,
        updatedAt: new Date()
      };
      MemoryAppRepository.apps.set(existing.id, updated);
      return { ...updated };
    } else {
      const newId = MemoryAppRepository.idCounter++;
      const created: Application = {
        ...app,
        id: newId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      MemoryAppRepository.apps.set(newId, created);
      return { ...created };
    }
  }

  public static clear(): void {
    MemoryAppRepository.apps.clear();
    MemoryAppRepository.idCounter = 1;
  }
}

export class MemorySessionRepository implements ISessionRepository {
  private static sessions = new Map<number, SessionCredential>();
  private static idCounter = 1;

  public async saveSession(appId: number, session: SessionCredential): Promise<void> {
    const newId = MemorySessionRepository.idCounter++;
    const saved: SessionCredential = {
      ...session,
      id: newId,
      appId,
      capturedAt: session.capturedAt || new Date()
    };
    MemorySessionRepository.sessions.set(newId, saved);
  }

  public async getActiveSession(appId: number, sessionUuidOrUserId?: string): Promise<SessionCredential | null> {
    const list = Array.from(MemorySessionRepository.sessions.values())
      .filter(s => s.appId === appId && s.isActive);
    if (sessionUuidOrUserId) {
      const found = list.find(s => s.sessionUuid === sessionUuidOrUserId || s.userId === sessionUuidOrUserId);
      return found ? { ...found } : null;
    }
    return list.length > 0 ? { ...list[list.length - 1] } : null;
  }

  public async listSessions(appId: number): Promise<SessionCredential[]> {
    return Array.from(MemorySessionRepository.sessions.values())
      .filter(s => s.appId === appId)
      .map(s => ({ ...s }));
  }

  public async invalidate(sessionId: number): Promise<void> {
    const session = MemorySessionRepository.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
    }
  }

  public async deleteInactiveSessions(appId: number): Promise<void> {
    for (const [id, session] of MemorySessionRepository.sessions.entries()) {
      if (session.appId === appId && !session.isActive) {
        MemorySessionRepository.sessions.delete(id);
      }
    }
  }

  public static clear(): void {
    MemorySessionRepository.sessions.clear();
    MemorySessionRepository.idCounter = 1;
  }
}

export class MemoryEndpointRepository implements IEndpointRepository {
  private static endpoints = new Map<number, EndpointDefinition>();
  private static idCounter = 1;

  public async list(appId: number): Promise<EndpointDefinition[]> {
    return Array.from(MemoryEndpointRepository.endpoints.values())
      .filter(e => e.appId === appId)
      .map(e => ({ ...e }));
  }

  public async findByName(appId: number, name: string): Promise<EndpointDefinition | null> {
    for (const def of MemoryEndpointRepository.endpoints.values()) {
      if (def.appId === appId && def.name.toLowerCase() === name.toLowerCase()) {
        return { ...def };
      }
    }
    return null;
  }

  public async upsert(def: EndpointDefinition): Promise<EndpointDefinition> {
    if (def.httpMethod && !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(def.httpMethod.toUpperCase())) {
      throw new Error(`Invalid httpMethod: ${def.httpMethod}`);
    }

    const existing = await this.findByName(def.appId, def.name);
    if (existing && existing.id) {
      const updated: EndpointDefinition = {
        ...existing,
        ...def,
        id: existing.id
      };
      MemoryEndpointRepository.endpoints.set(existing.id, updated);
      return { ...updated };
    } else {
      const newId = MemoryEndpointRepository.idCounter++;
      const created: EndpointDefinition = {
        ...def,
        id: newId,
        createdAt: new Date()
      };
      MemoryEndpointRepository.endpoints.set(newId, created);
      return { ...created };
    }
  }

  public static clear(): void {
    MemoryEndpointRepository.endpoints.clear();
    MemoryEndpointRepository.idCounter = 1;
  }
}

export class MemoryAuditLogRepository implements IAuditLogRepository {
  private static logs: AuditLog[] = [];
  private static idCounter = 1;

  public async save(log: AuditLog): Promise<AuditLog> {
    const newId = MemoryAuditLogRepository.idCounter++;
    const saved: AuditLog = {
      ...log,
      id: newId,
      executedAt: log.executedAt || new Date()
    };
    MemoryAuditLogRepository.logs.push(saved);
    return { ...saved };
  }

  public static clear(): void {
    MemoryAuditLogRepository.logs = [];
    MemoryAuditLogRepository.idCounter = 1;
  }

  public static getLogs(): AuditLog[] {
    return [...MemoryAuditLogRepository.logs];
  }
}
