import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  Application,
  SessionCredential,
  EndpointDefinition,
  AuditLog,
  IAppRepository,
  ISessionRepository,
  IEndpointRepository,
  IAuditLogRepository,
  DEFAULT_AUTH_TYPE,
  DEFAULT_APPLICATION_STATUS
} from "@polygate/core";

export class YamlHelper {
  private static seedDir = (() => {
    if (process.env.SEED_DIR) {
      return process.env.SEED_DIR;
    }
    let current = process.cwd();
    while (true) {
      const hasWorkspace = fs.existsSync(path.join(current, "pnpm-workspace.yaml"));
      const hasRealSeed = fs.existsSync(path.join(current, "seed-data", "index.yaml"));
      if (hasWorkspace || hasRealSeed) {
        return path.join(current, "seed-data");
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return path.join(process.cwd(), "seed-data");
  })();

  public static getSeedDir(): string {
    return this.seedDir;
  }

  public static setSeedDir(dir: string): void {
    this.seedDir = dir;
  }

  public static ensureDirectories() {
    const dir = this.getSeedDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const appsDir = path.join(dir, "apps");
    if (!fs.existsSync(appsDir)) {
      fs.mkdirSync(appsDir, { recursive: true });
    }
    const endpointsDir = path.join(dir, "endpoints");
    if (!fs.existsSync(endpointsDir)) {
      fs.mkdirSync(endpointsDir, { recursive: true });
    }
  }

  public static loadIndex(): string[] {
    this.ensureDirectories();
    const indexPath = path.join(this.getSeedDir(), "index.yaml");
    if (!fs.existsSync(indexPath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(indexPath, "utf8");
      const doc = yaml.load(content) as any;
      return doc?.load || [];
    } catch {
      return [];
    }
  }

  public static saveIndex(files: string[]) {
    this.ensureDirectories();
    const indexPath = path.join(this.getSeedDir(), "index.yaml");
    const content = yaml.dump({ load: files });
    fs.writeFileSync(indexPath, content, "utf8");
  }
}

export class YamlAppRepository implements IAppRepository {
  private static appCache = new Map<number, Application>();
  private static appKeyToId = new Map<string, number>();
  private static idCounter = 1;

  constructor() {
    this.reloadCache();
  }

  private reloadCache() {
    YamlHelper.ensureDirectories();
    YamlAppRepository.appCache.clear();
    YamlAppRepository.appKeyToId.clear();
    YamlAppRepository.idCounter = 1;

    const files = YamlHelper.loadIndex();
    for (const relativePath of files) {
      const fullPath = path.join(YamlHelper.getSeedDir(), relativePath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const doc = yaml.load(content) as any;
          if (doc && doc.app) {
            const appKey = doc.app.key || doc.app.appKey;
            if (!appKey) {
              throw new Error("Application key is missing in YAML");
            }
            const app: Application = {
              appKey,
              displayName: doc.app.displayName || appKey,
              baseUrl: doc.app.baseUrl,
              loginUrl: doc.app.loginUrl,
              domainId: doc.app.domainId,
              authType: doc.app.authType || DEFAULT_AUTH_TYPE,
              status: doc.app.status || DEFAULT_APPLICATION_STATUS,
              loginSuccessUrlPattern: doc.app.loginSuccessUrlPattern,
              loginSuccessCookieName: doc.app.loginSuccessCookieName,
              sessionInjectionRules: doc.app.sessionInjectionRules
                ? (typeof doc.app.sessionInjectionRules === "object"
                    ? JSON.stringify(doc.app.sessionInjectionRules)
                    : doc.app.sessionInjectionRules)
                : undefined,
              userIdCookieName: doc.app.userIdCookieName,
              sessionCaptureHeaders: doc.app.sessionCaptureHeaders,
              createdAt: doc.app.createdAt ? new Date(doc.app.createdAt) : new Date(),
              updatedAt: doc.app.updatedAt ? new Date(doc.app.updatedAt) : new Date()
            };

            const id = YamlAppRepository.idCounter++;
            app.id = id;
            YamlAppRepository.appCache.set(id, app);
            YamlAppRepository.appKeyToId.set(appKey.toLowerCase(), id);
          }
        } catch (err: any) {
          console.warn(`[WARN] Failed to load application config from ${fullPath}: ${err.message}`);
        }
      }
    }

    // Also load apps from specs/ directories
    const specsDir = path.join(YamlHelper.getSeedDir(), "specs");
    if (fs.existsSync(specsDir)) {
      const specFiles = fs.readdirSync(specsDir).filter(f => f.endsWith("-openapi.yaml"));
      for (const file of specFiles) {
        try {
          const fullPath = path.join(specsDir, file);
          const content = fs.readFileSync(fullPath, "utf8");
          const doc = yaml.load(content) as any;
          const appKey = doc?.["x-polygate-app-key"];
          if (appKey) {
            const app: Application = {
              appKey,
              displayName: doc["x-polygate-display-name"] || appKey,
              baseUrl: doc.servers?.[0]?.url || "http://localhost",
              loginUrl: doc["x-polygate-login-url"],
              authType: doc["x-polygate-auth-type"] || "NONE",
              status: doc["x-polygate-status"] || "ACTIVE",
              loginSuccessUrlPattern: doc["x-polygate-login-success-url-pattern"],
              loginSuccessCookieName: doc["x-polygate-login-success-cookie-name"],
              sessionInjectionRules: doc["x-polygate-session-injection-rules"]
                ? (typeof doc["x-polygate-session-injection-rules"] === "object"
                    ? JSON.stringify(doc["x-polygate-session-injection-rules"])
                    : doc["x-polygate-session-injection-rules"])
                : undefined,
              userIdCookieName: doc["x-polygate-user-id-cookie-name"],
              sessionCaptureHeaders: doc["x-polygate-session-capture-headers"],
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const existingId = YamlAppRepository.appKeyToId.get(appKey.toLowerCase());
            if (existingId) {
              app.id = existingId;
              YamlAppRepository.appCache.set(existingId, app);
            } else {
              const id = YamlAppRepository.idCounter++;
              app.id = id;
              YamlAppRepository.appCache.set(id, app);
              YamlAppRepository.appKeyToId.set(appKey.toLowerCase(), id);
            }
          }
        } catch (err: any) {
          console.warn(`[WARN] Failed to load spec config from ${file}: ${err.message}`);
        }
      }
    }
  }

  public async findByKey(appKey: string): Promise<Application | null> {
    this.reloadCache();
    const id = YamlAppRepository.appKeyToId.get(appKey.toLowerCase());
    if (id) {
      const app = YamlAppRepository.appCache.get(id);
      return app ? { ...app } : null;
    }
    return null;
  }

  public async list(): Promise<Application[]> {
    this.reloadCache();
    return Array.from(YamlAppRepository.appCache.values()).map(app => ({ ...app }));
  }

  public async upsert(app: Application): Promise<Application> {
    YamlHelper.ensureDirectories();
    const appKey = app.appKey;
    const relativePath = `apps/${appKey}.yaml`;
    const fullPath = path.join(YamlHelper.getSeedDir(), relativePath);

    let rulesObj: any = undefined;
    if (app.sessionInjectionRules) {
      try {
        rulesObj = typeof app.sessionInjectionRules === "string"
          ? JSON.parse(app.sessionInjectionRules)
          : app.sessionInjectionRules;
      } catch {
        rulesObj = app.sessionInjectionRules;
      }
    }

    const appYamlDoc = {
      app: {
        key: app.appKey,
        displayName: app.displayName,
        baseUrl: app.baseUrl,
        loginUrl: app.loginUrl,
        domainId: app.domainId,
        authType: app.authType,
        status: app.status,
        loginSuccessUrlPattern: app.loginSuccessUrlPattern,
        loginSuccessCookieName: app.loginSuccessCookieName,
        sessionInjectionRules: rulesObj,
        userIdCookieName: app.userIdCookieName,
        sessionCaptureHeaders: app.sessionCaptureHeaders,
        createdAt: app.createdAt ? new Date(app.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };

    fs.writeFileSync(fullPath, yaml.dump(appYamlDoc), "utf8");

    // Add to index if not already present
    const indexFiles = YamlHelper.loadIndex();
    if (!indexFiles.includes(relativePath)) {
      indexFiles.push(relativePath);
      YamlHelper.saveIndex(indexFiles);
    }

    this.reloadCache();
    const resolved = await this.findByKey(appKey);
    if (!resolved) {
      throw new Error("Failed to reload cache after upserting application");
    }
    return resolved;
  }
}

export class YamlSessionRepository implements ISessionRepository {
  private getSessionsPath(): string {
    return path.join(YamlHelper.getSeedDir(), "sessions.json");
  }

  private loadSessions(): SessionCredential[] {
    const filePath = this.getSessionsPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const list = JSON.parse(content) as any[];
      return list.map(item => ({
        ...item,
        capturedAt: item.capturedAt ? new Date(item.capturedAt) : undefined,
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined
      }));
    } catch {
      return [];
    }
  }

  private saveSessions(sessions: SessionCredential[]) {
    const filePath = this.getSessionsPath();
    fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), "utf8");
  }

  public async saveSession(appId: number, session: SessionCredential): Promise<void> {
    const sessions = this.loadSessions();
    const id = sessions.length + 1;
    const newSession: SessionCredential = {
      ...session,
      id,
      appId,
      capturedAt: session.capturedAt || new Date()
    };
    sessions.push(newSession);
    this.saveSessions(sessions);
  }

  public async getActiveSession(appId: number, sessionUuidOrUserId?: string): Promise<SessionCredential | null> {
    const sessions = this.loadSessions();
    const activeSessions = sessions.filter(s => s.appId === appId && s.isActive);
    if (sessionUuidOrUserId) {
      const matched = activeSessions.find(s => s.sessionUuid === sessionUuidOrUserId || s.userId === sessionUuidOrUserId);
      return matched || null;
    }
    return activeSessions.length > 0 ? activeSessions[activeSessions.length - 1] : null;
  }

  public async listSessions(appId: number): Promise<SessionCredential[]> {
    const sessions = this.loadSessions();
    return sessions.filter(s => s.appId === appId);
  }

  public async invalidate(sessionId: number): Promise<void> {
    const sessions = this.loadSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.isActive = false;
      this.saveSessions(sessions);
    }
  }

  public async deleteInactiveSessions(appId: number): Promise<void> {
    const sessions = this.loadSessions();
    const filtered = sessions.filter(s => !(s.appId === appId && !s.isActive));
    this.saveSessions(filtered);
  }
}

export class YamlEndpointRepository implements IEndpointRepository {
  constructor(private appRepository: IAppRepository) {}

  private getAppEndpointsDir(appKey: string): string {
    const endpointsDir = path.join(YamlHelper.getSeedDir(), "endpoints", appKey.toLowerCase());
    if (!fs.existsSync(endpointsDir)) {
      fs.mkdirSync(endpointsDir, { recursive: true });
    }
    return endpointsDir;
  }

  public async list(appId: number): Promise<EndpointDefinition[]> {
    const apps = await this.appRepository.list();
    const app = apps.find(a => a.id === appId);
    if (!app) return [];

    const specPath = path.join(YamlHelper.getSeedDir(), "specs", `${app.appKey.toLowerCase()}-openapi.yaml`);
    if (fs.existsSync(specPath)) {
      try {
        const content = fs.readFileSync(specPath, "utf8");
        const doc = yaml.load(content) as any;
        const result: EndpointDefinition[] = [];
        let idCounter = 1;

        if (doc && doc.paths && typeof doc.paths === "object") {
          for (const [pathKey, pathObj] of Object.entries(doc.paths)) {
            if (pathObj && typeof pathObj === "object") {
              for (const [methodKey, methodObj] of Object.entries(pathObj)) {
                const operation = methodObj as any;
                if (operation) {
                  const headers: Record<string, string> = {};
                  if (Array.isArray(operation.parameters)) {
                    for (const param of operation.parameters) {
                      if (param.in === "header") {
                        headers[param.name] = param.schema?.default || "required";
                      }
                    }
                  }

                  const reqSchema = operation.requestBody?.content?.["application/json"]?.schema;
                  const resSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema;

                  result.push({
                    id: idCounter++,
                    appId,
                    name: operation.operationId || operation.summary || `endpoint_${methodKey}_${pathKey.replace(/[^a-zA-Z0-9]/g, "_")}`,
                    path: pathKey,
                    httpMethod: methodKey.toUpperCase() as any,
                    requiresAuth: !!operation.security,
                    requestHeaders: headers,
                    requestBodySchema: reqSchema,
                    responseBodySchema: resSchema,
                    description: operation.description,
                    createdAt: new Date()
                  });
                }
              }
            }
          }
        }
        return result;
      } catch (err: any) {
        console.warn(`[WARN] Failed to parse OpenAPI Spec endpoints: ${err.message}`);
      }
    }

    const endpointsDir = this.getAppEndpointsDir(app.appKey);
    const files = fs.readdirSync(endpointsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

    const result: EndpointDefinition[] = [];
    let idCounter = 1;
    for (const file of files) {
      try {
        const fullPath = path.join(endpointsDir, file);
        const content = fs.readFileSync(fullPath, "utf8");
        const doc = yaml.load(content) as any;
        if (doc && doc.endpoint) {
          const headers: Record<string, string> = {};
          if (Array.isArray(doc.endpoint.requestHeaders)) {
            for (const header of doc.endpoint.requestHeaders) {
              headers[header.name] = header.value || "required";
            }
          } else if (doc.endpoint.requestHeaders && typeof doc.endpoint.requestHeaders === "object") {
            Object.assign(headers, doc.endpoint.requestHeaders);
          }

          result.push({
            id: idCounter++,
            appId,
            versionId: doc.endpoint.versionId,
            name: doc.endpoint.name,
            purposeId: doc.endpoint.purposeId,
            protocolType: doc.endpoint.protocolType || "HTTP",
            path: doc.endpoint.path,
            httpMethod: doc.endpoint.method || "GET",
            wsUrlPath: doc.endpoint.wsUrlPath,
            wsSubprotocol: doc.endpoint.wsSubprotocol,
            wsMessageSchema: doc.endpoint.wsMessageSchema,
            requiresAuth: doc.endpoint.requiresAuth ?? true,
            requestHeaders: headers,
            requestBodySchema: doc.endpoint.requestBody,
            responseBodySchema: doc.endpoint.responseBody,
            sampleResponse: doc.endpoint.sampleResponse,
            description: doc.endpoint.description,
            createdAt: doc.endpoint.createdAt ? new Date(doc.endpoint.createdAt) : new Date()
          });
        }
      } catch (err) {
        // ignore individual parse errors
      }
    }
    return result;
  }

  public async findByName(appId: number, name: string): Promise<EndpointDefinition | null> {
    const endpoints = await this.list(appId);
    return endpoints.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
  }

  public async upsert(def: EndpointDefinition): Promise<EndpointDefinition> {
    const apps = await this.appRepository.list();
    const app = apps.find(a => a.id === def.appId);
    if (!app) {
      throw new Error(`Application with ID ${def.appId} not found.`);
    }

    const endpointsDir = this.getAppEndpointsDir(app.appKey);
    const fileName = `${def.name}.yaml`;
    const fullPath = path.join(endpointsDir, fileName);

    const headersArray: any[] = [];
    if (def.requestHeaders) {
      for (const [name, val] of Object.entries(def.requestHeaders)) {
        headersArray.push({
          name,
          required: val === "required",
          ...(val !== "required" ? { value: val } : {})
        });
      }
    }

    const endpointYamlDoc = {
      endpoint: {
        app: app.appKey,
        versionId: def.versionId,
        name: def.name,
        purposeId: def.purposeId,
        protocolType: def.protocolType || "HTTP",
        path: def.path,
        method: def.httpMethod,
        wsUrlPath: def.wsUrlPath,
        wsSubprotocol: def.wsSubprotocol,
        wsMessageSchema: def.wsMessageSchema,
        requiresAuth: def.requiresAuth,
        requestHeaders: headersArray,
        requestBody: def.requestBodySchema,
        responseBody: def.responseBodySchema,
        sampleResponse: def.sampleResponse,
        description: def.description,
        createdAt: def.createdAt ? new Date(def.createdAt).toISOString() : new Date().toISOString()
      }
    };

    fs.writeFileSync(fullPath, yaml.dump(endpointYamlDoc), "utf8");
    const reloaded = await this.findByName(def.appId, def.name);
    if (!reloaded) {
      throw new Error("Failed to find endpoint after yaml upsert");
    }
    return reloaded;
  }
}

export class YamlAuditLogRepository implements IAuditLogRepository {
  private getAuditLogsPath(): string {
    return path.join(YamlHelper.getSeedDir(), "audit_logs.json");
  }

  private loadLogs(): AuditLog[] {
    const filePath = this.getAuditLogsPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const list = JSON.parse(content) as any[];
      return list.map(item => ({
        ...item,
        executedAt: item.executedAt ? new Date(item.executedAt) : undefined
      }));
    } catch {
      return [];
    }
  }

  private saveLogs(logs: AuditLog[]) {
    const filePath = this.getAuditLogsPath();
    fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), "utf8");
  }

  public async save(log: AuditLog): Promise<AuditLog> {
    const logs = this.loadLogs();
    const id = logs.length + 1;
    const newLog: AuditLog = {
      ...log,
      id,
      executedAt: log.executedAt || new Date()
    };
    logs.push(newLog);
    this.saveLogs(logs);
    return newLog;
  }
}
