import "reflect-metadata";
import { CryptoService } from "../services/CryptoService.js";
import { SessionService } from "../services/SessionService.js";
import { Application } from "../entities/Application.js";
import { SessionCredential } from "../entities/SessionCredential.js";
import { IAppRepository } from "../ports/IAppRepository.js";
import { ISessionRepository } from "../ports/ISessionRepository.js";

class MockAppRepository implements IAppRepository {
  private apps = new Map<number, Application>();
  private counter = 1;

  public async findByKey(appKey: string): Promise<Application | null> {
    return Array.from(this.apps.values()).find(a => a.appKey.toLowerCase() === appKey.toLowerCase()) || null;
  }
  public async list(): Promise<Application[]> {
    return Array.from(this.apps.values());
  }
  public async upsert(app: Application): Promise<Application> {
    const existing = await this.findByKey(app.appKey);
    if (existing && existing.id) {
      const updated = { ...existing, ...app };
      this.apps.set(existing.id, updated);
      return updated;
    }
    const id = this.counter++;
    const created = { ...app, id };
    this.apps.set(id, created);
    return created;
  }
}

class MockSessionRepository implements ISessionRepository {
  private sessions = new Map<number, SessionCredential>();
  private counter = 1;

  public async saveSession(appId: number, session: SessionCredential): Promise<void> {
    const id = this.counter++;
    this.sessions.set(id, { ...session, id, appId });
  }
  public async getActiveSession(appId: number, sessionUuidOrUserId?: string): Promise<SessionCredential | null> {
    const active = Array.from(this.sessions.values()).filter(s => s.appId === appId && s.isActive);
    if (sessionUuidOrUserId) {
      return active.find(s => s.sessionUuid === sessionUuidOrUserId || s.userId === sessionUuidOrUserId) || null;
    }
    return active.length > 0 ? active[active.length - 1] : null;
  }
  public async listSessions(appId: number): Promise<SessionCredential[]> {
    return Array.from(this.sessions.values()).filter(s => s.appId === appId);
  }
  public async invalidate(sessionId: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) s.isActive = false;
  }
}

import { AuditLogService } from "../services/AuditLogService.js";
import { AuditLog } from "../entities/AuditLog.js";
import { IAuditLogRepository } from "../ports/IAuditLogRepository.js";

class MockAuditLogRepository implements IAuditLogRepository {
  public async save(log: AuditLog): Promise<AuditLog> {
    return { ...log, id: 1 };
  }
}

describe("CryptoService", () => {
  it("should encrypt and decrypt strings successfully", () => {
    const cryptoService = new CryptoService();
    const originalText = "super-secret-session-cookie-123456";

    const encrypted = cryptoService.encrypt(originalText);
    expect(encrypted).not.toEqual(originalText);
    expect(encrypted.split(":").length).toBe(3);

    const decrypted = cryptoService.decrypt(encrypted);
    expect(decrypted).toEqual(originalText);
  });

  it("should throw error when decrypting invalid format", () => {
    const cryptoService = new CryptoService();
    expect(() => cryptoService.decrypt("invalid-format")).toThrow();
  });
});

describe("SessionService", () => {
  let appRepo: MockAppRepository;
  let sessionRepo: MockSessionRepository;
  let cryptoService: CryptoService;
  let auditLogRepo: MockAuditLogRepository;
  let auditLogService: AuditLogService;
  let sessionService: SessionService;

  beforeEach(async () => {
    appRepo = new MockAppRepository();
    sessionRepo = new MockSessionRepository();
    cryptoService = new CryptoService();
    auditLogRepo = new MockAuditLogRepository();
    auditLogService = new AuditLogService(auditLogRepo);
    sessionService = new SessionService(sessionRepo, appRepo, cryptoService, auditLogService);

    // Upsert app
    const app: Application = {
      appKey: "kite",
      displayName: "Zerodha Kite",
      baseUrl: "https://kite.zerodha.com",
      authType: "NONE",
      status: "ACTIVE"
    };
    await appRepo.upsert(app);
  });

  it("should encrypt and save active sessions and decrypt them back", async () => {
    const cookies = [{ name: "kf_session", value: "abcde12345", domain: "kite.zerodha.com" }];
    const headers = { "Authorization": "token123" };

    await sessionService.saveSession("kite", cookies, headers);

    const activeSession = await sessionService.getActiveSession("kite");
    expect(activeSession).not.toBeNull();
    expect(activeSession?.cookies).toEqual(cookies);
    expect(activeSession?.headers).toEqual(headers);
  });

  it("should return null for apps with no session", async () => {
    const active = await sessionService.getActiveSession("non-existent");
    expect(active).toBeNull();
  });

  it("should record LOGIN and LOGOUT actions in the audit log", async () => {
    const saveSpy = jest.spyOn(auditLogRepo, "save");

    const cookies = [{ name: "kf_session", value: "abcde12345" }];
    const headers = { "Authorization": "token123" };

    // 1. Save session (should trigger LOGIN log)
    await sessionService.saveSession("kite", cookies, headers);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].action).toBe("LOGIN");
    expect(saveSpy.mock.calls[0][0].detail).toContain("Successful login session captured");

    // 2. Invalidate active session (should trigger LOGOUT log)
    saveSpy.mockClear();
    await sessionService.invalidateActiveSession("kite");
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].action).toBe("LOGOUT");
    expect(saveSpy.mock.calls[0][0].detail).toContain("Active session explicitly invalidated");
  });

  it("should store and fetch multiple sessions for different userIds under the same app without overlap", async () => {
    // 1. Save session for User A
    const cookiesA = [{ name: "user_id", value: "userA" }, { name: "session_token", value: "tokenA" }];
    await sessionService.saveSession("kite", cookiesA, {});

    // 2. Save session for User B
    const cookiesB = [{ name: "user_id", value: "userB" }, { name: "session_token", value: "tokenB" }];
    await sessionService.saveSession("kite", cookiesB, {});

    // 3. Fetch session for User A
    const activeA = await sessionService.getActiveSession("kite", "userA");
    expect(activeA).not.toBeNull();
    expect(activeA?.cookies.find(c => c.name === "user_id")?.value).toBe("userA");
    expect(activeA?.cookies.find(c => c.name === "session_token")?.value).toBe("tokenA");

    // 4. Fetch session for User B
    const activeB = await sessionService.getActiveSession("kite", "userB");
    expect(activeB).not.toBeNull();
    expect(activeB?.cookies.find(c => c.name === "user_id")?.value).toBe("userB");
    expect(activeB?.cookies.find(c => c.name === "session_token")?.value).toBe("tokenB");

    // 5. Invalidate User A session only
    await sessionService.invalidateActiveSession("kite", "userA");
    expect(await sessionService.getActiveSession("kite", "userA")).toBeNull();
    expect(await sessionService.getActiveSession("kite", "userB")).not.toBeNull();
  });

  it("should assign a sessionUuid to new sessions and allow querying via UUID", async () => {
    const cookies = [{ name: "user_id", value: "userUUIDTest" }];
    await sessionService.saveSession("kite", cookies, {});

    // Obtain the generated session directly from repo
    const active = await sessionRepo.getActiveSession(1);
    expect(active).not.toBeNull();
    const sessionUuid = active?.sessionUuid;
    expect(sessionUuid).toBeDefined();
    expect(typeof sessionUuid).toBe("string");

    // Fetch using sessionUuid
    const activeByUuid = await sessionService.getActiveSession("kite", sessionUuid);
    expect(activeByUuid).not.toBeNull();
    expect(activeByUuid?.cookies[0].value).toBe("userUUIDTest");
  });
});
