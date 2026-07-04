import "reflect-metadata";
import { ProxyService, ProxyRequest } from "@/services/ProxyService.js";
import { AppService } from "@/services/AppService.js";
import { SessionService } from "@/services/SessionService.js";
import { EndpointService } from "@/services/EndpointService.js";
import { AuditLogService } from "@/services/AuditLogService.js";
import { CryptoService } from "@/services/CryptoService.js";
import { Application } from "@/entities/Application.js";
import { SessionCredential } from "@/entities/SessionCredential.js";
import { EndpointDefinition } from "@/entities/EndpointDefinition.js";
import { AuditLog } from "@/entities/AuditLog.js";
import { IAppRepository } from "@/ports/IAppRepository.js";
import { ISessionRepository } from "@/ports/ISessionRepository.js";
import { IEndpointRepository } from "@/ports/IEndpointRepository.js";
import { IAuditLogRepository } from "@/ports/IAuditLogRepository.js";

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

class MockEndpointRepository implements IEndpointRepository {
  private endpoints = new Map<number, EndpointDefinition>();
  private counter = 1;

  public async list(appId: number): Promise<EndpointDefinition[]> {
    return Array.from(this.endpoints.values()).filter(e => e.appId === appId);
  }
  public async findByName(appId: number, name: string): Promise<EndpointDefinition | null> {
    return Array.from(this.endpoints.values()).find(e => e.appId === appId && e.name.toLowerCase() === name.toLowerCase()) || null;
  }
  public async upsert(def: EndpointDefinition): Promise<EndpointDefinition> {
    const existing = Array.from(this.endpoints.values()).find(e => e.appId === def.appId && e.name.toLowerCase() === def.name.toLowerCase());
    if (existing && existing.id) {
      const updated = { ...existing, ...def };
      this.endpoints.set(existing.id, updated);
      return updated;
    }
    const id = this.counter++;
    const created = { ...def, id };
    this.endpoints.set(id, created);
    return created;
  }
}

class MockAuditLogRepository implements IAuditLogRepository {
  private logs: AuditLog[] = [];
  private counter = 1;

  public async save(log: AuditLog): Promise<AuditLog> {
    const id = this.counter++;
    const created = { ...log, id, executedAt: log.executedAt || new Date() };
    this.logs.push(created);
    return created;
  }
}

describe("ProxyService Unit Tests", () => {
  let appRepo: MockAppRepository;
  let sessionRepo: MockSessionRepository;
  let endpointRepo: MockEndpointRepository;
  let auditLogRepo: MockAuditLogRepository;
  let cryptoService: CryptoService;

  let appService: AppService;
  let sessionService: SessionService;
  let endpointService: EndpointService;
  let auditLogService: AuditLogService;
  let proxyService: ProxyService;

  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    appRepo = new MockAppRepository();
    sessionRepo = new MockSessionRepository();
    endpointRepo = new MockEndpointRepository();
    auditLogRepo = new MockAuditLogRepository();
    cryptoService = new CryptoService();

    appService = new AppService(appRepo);
    auditLogService = new AuditLogService(auditLogRepo);
    sessionService = new SessionService(sessionRepo, appRepo, cryptoService, auditLogService);
    endpointService = new EndpointService(endpointRepo, appRepo);

    proxyService = new ProxyService(
      appService,
      sessionService,
      endpointService,
      auditLogService
    );

    originalFetch = globalThis.fetch;

    // Create an active application
    await appRepo.upsert({
      appKey: "dashboard-app",
      displayName: "Dashboard App",
      baseUrl: "https://internal-dashboard.local",
      authType: "OAUTH",
      status: "ACTIVE"
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should inject cookies and headers from active session to proxy request", async () => {
    // 1. Save an active session with specific cookies and headers
    const rawCookies = [{ name: "session_id", value: "secret-cookie-xyz-987" }];
    const rawHeaders = { "X-API-Token": "api-token-value-abc" };
    await sessionService.saveSession("dashboard-app", rawCookies, rawHeaders);

    // 2. Mock global fetch
    const mockResponse = new Response(JSON.stringify({ user: "punit", role: "admin" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    // 3. Perform proxy call
    const req: ProxyRequest = {
      method: "GET",
      path: "/api/profile",
      queryParams: { format: "json", detail: "true" },
      headers: { "accept": "application/json", "host": "should-be-removed" }
    };

    const res = await proxyService.proxy("dashboard-app", req);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({ user: "punit", role: "admin" });

    // 4. Verify fetch options
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [targetUrl, options] = fetchMock.mock.calls[0];

    // Verify constructed URL contains base URL, path, and query params
    expect(targetUrl).toBe("https://internal-dashboard.local/api/profile?format=json&detail=true");

    // Verify final headers contain both original headers (excluding host/connection) and session credentials
    expect(options.method).toBe("GET");
    expect(options.headers["accept"]).toBe("application/json");
    expect(options.headers["host"]).toBeUndefined();
    expect(options.headers["x-api-token"]).toBe("api-token-value-abc");
    expect(options.headers["cookie"]).toBe("session_id=secret-cookie-xyz-987");
  });

  it("should handle disabled applications by returning 403 Forbidden", async () => {
    await appRepo.upsert({
      appKey: "disabled-app",
      displayName: "Disabled App",
      baseUrl: "https://disabled.local",
      authType: "NONE",
      status: "DISABLED"
    });

    const req: ProxyRequest = {
      method: "GET",
      path: "/",
      queryParams: {},
      headers: {}
    };

    const res = await proxyService.proxy("disabled-app", req);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body.toString())).toEqual({ error: "Application is disabled" });
  });

  it("should perform schema validation if requestBodySchema is defined", async () => {
    // 1. Create app and define an endpoint that has request validation
    const app = await appRepo.upsert({
      appKey: "validation-app",
      displayName: "Validation App",
      baseUrl: "https://validation.local",
      authType: "NONE",
      status: "ACTIVE"
    });

    await endpointRepo.upsert({
      appId: app.id!,
      name: "updateProfile",
      path: "/profile",
      httpMethod: "POST",
      requiresAuth: false,
      requestHeaders: {},
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"]
      }
    });

    // 2. Perform proxy call with invalid request body (missing email)
    const req: ProxyRequest = {
      method: "POST",
      path: "/profile",
      queryParams: {},
      headers: {},
      body: { name: "Punit" } // missing email
    };

    const res = await proxyService.proxy("validation-app", req);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body.toString())).toEqual({
      error: "Request validation failed: Missing required property: email"
    });
  });

  it("should inject headers using dynamic sessionInjectionRules", async () => {
    // 1. Create app with dynamic injection rules
    const app = await appRepo.upsert({
      appKey: "dynamic-app",
      displayName: "Dynamic App",
      baseUrl: "https://dynamic.local",
      authType: "NONE",
      status: "ACTIVE",
      sessionInjectionRules: JSON.stringify({
        headers: [
          {
            name: "authorization",
            source: "cookie",
            sourceName: "enctoken",
            template: "enctoken {value}"
          },
          {
            name: "x-custom-userid",
            source: "cookie",
            sourceName: "user_id"
          },
          {
            name: "x-custom-version",
            source: "static",
            value: "1.0.0"
          }
        ]
      })
    });

    // 2. Save active session with enctoken and user_id cookies
    const rawCookies = [
      { name: "enctoken", value: "abc-token" },
      { name: "user_id", value: "punit123" }
    ];
    await sessionService.saveSession("dynamic-app", rawCookies, {});

    // 3. Mock global fetch
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    // 4. Perform proxy call
    const req: ProxyRequest = {
      method: "GET",
      path: "/test",
      queryParams: {},
      headers: {}
    };

    const res = await proxyService.proxy("dynamic-app", req);
    expect(res.statusCode).toBe(200);

    // 5. Verify custom headers were mapped correctly
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];

    expect(options.headers["authorization"]).toBe("enctoken abc-token");
    expect(options.headers["x-custom-userid"]).toBe("punit123");
    expect(options.headers["x-custom-version"]).toBe("1.0.0");
  });

  it("should segregate active sessions by matching incoming userId cookie/header", async () => {
    // 1. Create app that defines user_id cookie as the identifier
    const app = await appRepo.upsert({
      appKey: "segregated-app",
      displayName: "Segregated App",
      baseUrl: "https://segregated.local",
      authType: "NONE",
      status: "ACTIVE",
      userIdCookieName: "user_id",
      sessionInjectionRules: JSON.stringify({
        headers: [
          {
            name: "authorization",
            source: "cookie",
            sourceName: "session_token",
            template: "Bearer {value}"
          }
        ]
      })
    });

    // 2. Save session for User A
    const cookiesA = [
      { name: "user_id", value: "userA" },
      { name: "session_token", value: "tokenA" }
    ];
    await sessionService.saveSession("segregated-app", cookiesA, {});

    // 3. Save session for User B
    const cookiesB = [
      { name: "user_id", value: "userB" },
      { name: "session_token", value: "tokenB" }
    ];
    await sessionService.saveSession("segregated-app", cookiesB, {});

    // 4. Perform proxy call for User A
    const fetchMock = jest.fn().mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    });
    globalThis.fetch = fetchMock;

    const reqA: ProxyRequest = {
      method: "GET",
      path: "/test",
      queryParams: {},
      headers: { "Cookie": "user_id=userA" }
    };

    const resA = await proxyService.proxy("segregated-app", reqA);
    expect(resA.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["authorization"]).toBe("Bearer tokenA"); // Injected User A's token!

    // 5. Perform proxy call for User B
    fetchMock.mockClear();
    const reqB: ProxyRequest = {
      method: "GET",
      path: "/test",
      queryParams: {},
      headers: { "Cookie": "user_id=userB" }
    };

    const resB = await proxyService.proxy("segregated-app", reqB);
    expect(resB.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["authorization"]).toBe("Bearer tokenB"); // Injected User B's token!
  });

  it("should resolve active session based on session UUID passed in request headers", async () => {
    await sessionService.saveSession("dashboard-app", [{ name: "session_token", value: "cookie-1" }, { name: "userid", value: "user-1" }], { "X-Custom": "header-1" });
    await sessionService.saveSession("dashboard-app", [{ name: "session_token", value: "cookie-2" }, { name: "userid", value: "user-2" }], { "X-Custom": "header-2" });

    // Retrieve the sessions to get their UUIDs
    const activeSessions = await sessionRepo.listSessions(1);
    const sessionUuid1 = activeSessions[0].sessionUuid!; // First saved session (oldest)

    // Mock global fetch
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    // 2. Perform proxy call passing x-polygate-session-uuid header
    const req: ProxyRequest = {
      method: "GET",
      path: "/api/profile",
      queryParams: {},
      headers: { "x-polygate-session-uuid": sessionUuid1 }
    };

    const res = await proxyService.proxy("dashboard-app", req);
    expect(res.statusCode).toBe(200);

    // Verify correct session credentials were injected
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers["x-custom"]).toBe("header-1");
    expect(options.headers["cookie"]).toBe("session_token=cookie-1; userid=user-1");
  });
});

