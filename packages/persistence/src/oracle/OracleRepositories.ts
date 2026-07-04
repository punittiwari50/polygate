import type oracledb from "oracledb";
import {
  Application,
  SessionCredential,
  EndpointDefinition,
  AuditLog,
  IAppRepository,
  ISessionRepository,
  IEndpointRepository,
  IAuditLogRepository
} from "@polygate/core";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// ── Config loader (resolves ${ENV_VAR:default} placeholders) ─────────────────

class OracleConfigLoader {
  private static readonly ENV_PATTERN = /\$\{([^}:]+)(?::([^}]*))?\}/g;

  public load(configPath: string): any {
    const raw = fs.readFileSync(configPath, "utf8");
    const resolved = raw.replace(OracleConfigLoader.ENV_PATTERN, (_match, varName, defaultVal) => {
      return process.env[varName] ?? defaultVal ?? "";
    });
    return yaml.load(resolved) as any;
  }
}

/**
 * OracleConnectionManager — config-file-driven Oracle connection pool.
 *
 * Golden Rules satisfied:
 *  Rule 3 — Class-based; implements IConnectionManager shape (static + instance).
 *  Rule 4 — SRP: owns only Oracle connection lifecycle.
 *  Rule 6 — No cyclic imports.
 *  Rule 7 — Pool (7.1), fast-fail via queueTimeout (7.2), healthCheck (7.3), config file (7.6).
 */
export class OracleConnectionManager {
  private static pool: oracledb.Pool | null = null;
  private static _isHealthy = false;
  private static oracledbModule: any = null;

  private static async getOracledb(): Promise<any> {
    if (!OracleConnectionManager.oracledbModule) {
      OracleConnectionManager.oracledbModule = await import("oracledb").catch((err) => {
        throw new Error("Failed to load oracledb optional dependency. Ensure it is installed: " + err.message);
      });
    }
    return OracleConnectionManager.oracledbModule;
  }

  private static readonly DEFAULT_CONFIG_PATH = path.resolve(
    process.cwd(),
    "config/db/oracle/oracle-connection.yaml"
  );

  public static get isHealthy(): boolean {
    return OracleConnectionManager._isHealthy;
  }

  /**
   * Initialize pool from a YAML connection config file (config/db/oracle/oracle-connection.yaml).
   * Fast-fail: oracledb's queueTimeout enforces a hard deadline on pool acquisition.
   *
   * @param configPath - Optional override path to the YAML config file.
   */
  public static async initFromConfig(configPath?: string): Promise<void> {
    const resolvedPath = configPath ?? OracleConnectionManager.DEFAULT_CONFIG_PATH;
    const loader = new OracleConfigLoader();
    const cfg = loader.load(resolvedPath);

    await OracleConnectionManager.init({
      user: cfg.connection.user,
      password: cfg.connection.password,
      connectString: cfg.connection.connectString,
      poolMin: cfg.pool.min ?? 2,
      poolMax: cfg.pool.max ?? 10,
      poolIncrement: cfg.pool.increment ?? 1,
      queueTimeout: cfg.pool.queueTimeout ?? 2000,
      connectTimeout: cfg.pool.connectionTimeout ?? 1500,
      poolAlias: cfg.pool.poolAlias ?? "polygate-pool",
      poolPingInterval: cfg.pool.pingInterval ?? 60,
    });
  }

  /** Initialize from raw config object (kept for backward compatibility with tests). */
  public static async init(config: oracledb.PoolAttributes): Promise<void> {
    if (OracleConnectionManager.pool) return;

    const oracledbLib = await OracleConnectionManager.getOracledb();
    const createPoolPromise = oracledbLib.createPool(config);
    const timeoutMs = (config as any).connectTimeout ?? 1500;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Oracle connection timed out after ${timeoutMs}ms. Check oracle-connection.yaml.`)),
        timeoutMs
      )
    );

    OracleConnectionManager.pool = await Promise.race([createPoolPromise, timeoutPromise]);
    OracleConnectionManager._isHealthy = true;
  }

  public static async close(): Promise<void> {
    if (OracleConnectionManager.pool) {
      await OracleConnectionManager.pool.close();
      OracleConnectionManager.pool = null;
      OracleConnectionManager._isHealthy = false;
    }
  }

  public static async getConnection(): Promise<oracledb.Connection> {
    if (!OracleConnectionManager.pool) {
      throw new Error("Oracle connection pool not initialized. Call OracleConnectionManager.initFromConfig() first.");
    }
    return OracleConnectionManager.pool.getConnection();
  }

  /** PING health probe — executes SELECT 1 FROM DUAL, never throws (Rule 7.3). */
  public static async healthCheck(): Promise<boolean> {
    try {
      await OracleConnectionManager.execute("SELECT 1 FROM DUAL");
      OracleConnectionManager._isHealthy = true;
      return true;
    } catch {
      OracleConnectionManager._isHealthy = false;
      return false;
    }
  }

  public static async execute<T = any>(
    sql: string,
    binds: any = [],
    options: oracledb.ExecuteOptions = {}
  ): Promise<oracledb.Result<T>> {
    const conn = await OracleConnectionManager.getConnection();
    const oracledbLib = await OracleConnectionManager.getOracledb();
    try {
      options.outFormat = oracledbLib.OUT_FORMAT_OBJECT;
      options.autoCommit = options.autoCommit ?? true;
      const res = await conn.execute(sql, binds, options);
      return res as oracledb.Result<T>;
    } finally {
      await conn.close();
    }
  }
}


export class OracleAppRepository implements IAppRepository {
  private mapRow(row: any): Application {
    return {
      id: Number(row.APP_ID),
      appKey: row.APP_KEY,
      displayName: row.DISPLAY_NAME,
      baseUrl: row.BASE_URL,
      loginUrl: row.LOGIN_URL,
      domainId: row.DOMAIN_ID ? Number(row.DOMAIN_ID) : undefined,
      authType: row.AUTH_TYPE,
      status: row.STATUS,
      loginSuccessUrlPattern: row.LOGIN_SUCCESS_URL_PATTERN,
      loginSuccessCookieName: row.LOGIN_SUCCESS_COOKIE_NAME,
      sessionInjectionRules: row.SESSION_INJECTION_RULES || undefined,
      userIdCookieName: row.USER_ID_COOKIE_NAME || undefined,
      createdAt: row.CREATED_AT ? new Date(row.CREATED_AT) : undefined,
      updatedAt: row.UPDATED_AT ? new Date(row.UPDATED_AT) : undefined
    };
  }

  private async getOrCreateDefaultDomainId(): Promise<number> {
    const checkQuery = "SELECT DOMAIN_ID FROM PG_APPLICATION_DOMAIN WHERE DOMAIN_CODE = 'OTHER'";
    const checkRes = await OracleConnectionManager.execute(checkQuery);
    if (checkRes.rows && checkRes.rows.length > 0) {
      return Number((checkRes.rows[0] as any).DOMAIN_ID);
    }
    const insertQuery = "INSERT INTO PG_APPLICATION_DOMAIN (DOMAIN_CODE, DISPLAY_NAME, CREATED_AT, UPDATED_AT) VALUES ('OTHER', 'Other/General', SYSTIMESTAMP, SYSTIMESTAMP)";
    await OracleConnectionManager.execute(insertQuery);
    const recheckRes = await OracleConnectionManager.execute(checkQuery);
    return Number((recheckRes.rows![0] as any).DOMAIN_ID);
  }

  public async findByKey(appKey: string): Promise<Application | null> {
    const query = `
      SELECT 
        a.APP_ID, a.APP_KEY, a.DISPLAY_NAME, a.AUTH_TYPE, a.STATUS, a.CREATED_AT, a.UPDATED_AT, a.DOMAIN_ID,
        c.BASE_URL, c.LOGIN_URL, c.LOGIN_SUCCESS_URL_PATTERN, c.LOGIN_SUCCESS_COOKIE_NAME, c.SESSION_INJECTION_RULES, c.USER_ID_COOKIE_NAME
      FROM PG_APPLICATION a
      LEFT JOIN PG_APP_ACCESS_CHANNEL c ON a.APP_ID = c.APP_ID AND c.CHANNEL_TYPE = 'CUSTOMER'
      WHERE a.APP_KEY = :appKey
    `;
    const res = await OracleConnectionManager.execute(query, { appKey });
    if (res.rows && res.rows.length > 0) {
      return this.mapRow(res.rows[0]);
    }
    return null;
  }

  public async list(): Promise<Application[]> {
    const query = `
      SELECT 
        a.APP_ID, a.APP_KEY, a.DISPLAY_NAME, a.AUTH_TYPE, a.STATUS, a.CREATED_AT, a.UPDATED_AT, a.DOMAIN_ID,
        c.BASE_URL, c.LOGIN_URL, c.LOGIN_SUCCESS_URL_PATTERN, c.LOGIN_SUCCESS_COOKIE_NAME, c.SESSION_INJECTION_RULES, c.USER_ID_COOKIE_NAME
      FROM PG_APPLICATION a
      LEFT JOIN PG_APP_ACCESS_CHANNEL c ON a.APP_ID = c.APP_ID AND c.CHANNEL_TYPE = 'CUSTOMER'
      ORDER BY a.APP_ID ASC
    `;
    const res = await OracleConnectionManager.execute(query);
    if (res.rows) {
      return res.rows.map(r => this.mapRow(r));
    }
    return [];
  }

  public async upsert(app: Application): Promise<Application> {
    const domainId = app.domainId || await this.getOrCreateDefaultDomainId();

    const mergeAppQuery = `
      MERGE INTO PG_APPLICATION target
      USING (SELECT :appKey AS APP_KEY FROM dual) source
      ON (target.APP_KEY = source.APP_KEY)
      WHEN MATCHED THEN
        UPDATE SET
          DISPLAY_NAME = :displayName,
          DOMAIN_ID = :domainId,
          AUTH_TYPE = :authType,
          STATUS = :status,
          UPDATED_AT = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (
          APP_KEY, DISPLAY_NAME, DOMAIN_ID, AUTH_TYPE, STATUS, CREATED_AT, UPDATED_AT
        ) VALUES (
          source.APP_KEY, :displayName, :domainId, :authType, :status, SYSTIMESTAMP, SYSTIMESTAMP
        )
    `;
    await OracleConnectionManager.execute(mergeAppQuery, {
      appKey: app.appKey,
      displayName: app.displayName,
      domainId,
      authType: app.authType,
      status: app.status
    });

    const reloaded = await this.findByKey(app.appKey);
    if (!reloaded || !reloaded.id) {
      throw new Error(`Failed to find application ${app.appKey} after inserting/updating`);
    }

    const mergeChannelQuery = `
      MERGE INTO PG_APP_ACCESS_CHANNEL target
      USING (SELECT :appId AS APP_ID, 'CUSTOMER' AS CHANNEL_TYPE FROM DUAL) src
      ON (target.APP_ID = src.APP_ID AND target.CHANNEL_TYPE = src.CHANNEL_TYPE)
      WHEN MATCHED THEN
        UPDATE SET
          BASE_URL = :baseUrl,
          LOGIN_URL = :loginUrl,
          LOGIN_SUCCESS_URL_PATTERN = :loginSuccessUrlPattern,
          LOGIN_SUCCESS_COOKIE_NAME = :loginSuccessCookieName,
          SESSION_INJECTION_RULES = :sessionInjectionRules,
          USER_ID_COOKIE_NAME = :userIdCookieName,
          UPDATED_AT = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (APP_ID, CHANNEL_TYPE, BASE_URL, LOGIN_URL, LOGIN_SUCCESS_URL_PATTERN, LOGIN_SUCCESS_COOKIE_NAME, SESSION_INJECTION_RULES, USER_ID_COOKIE_NAME, CREATED_AT, UPDATED_AT)
        VALUES (src.APP_ID, src.CHANNEL_TYPE, :baseUrl, :loginUrl, :loginSuccessUrlPattern, :loginSuccessCookieName, :sessionInjectionRules, :userIdCookieName, SYSTIMESTAMP, SYSTIMESTAMP)
    `;
    await OracleConnectionManager.execute(mergeChannelQuery, {
      appId: reloaded.id,
      baseUrl: app.baseUrl,
      loginUrl: app.loginUrl || null,
      loginSuccessUrlPattern: app.loginSuccessUrlPattern || null,
      loginSuccessCookieName: app.loginSuccessCookieName || null,
      sessionInjectionRules: app.sessionInjectionRules || null,
      userIdCookieName: app.userIdCookieName || null
    });

    const finalReload = await this.findByKey(app.appKey);
    if (!finalReload) {
      throw new Error(`Failed to find application ${app.appKey} after Oracle upsert`);
    }
    return finalReload;
  }
}

export class OracleSessionRepository implements ISessionRepository {
  private mapRow(row: any): SessionCredential {
    return {
      id: Number(row.SESSION_ID),
      appId: Number(row.APP_ID),
      identityId: row.IDENTITY_ID ? Number(row.IDENTITY_ID) : undefined,
      cookiePayload: row.COOKIE_PAYLOAD,
      headerPayload: row.HEADER_PAYLOAD,
      userId: row.USER_ID || undefined,
      sessionUuid: row.SESSION_UUID,
      capturedAt: row.CAPTURED_AT ? new Date(row.CAPTURED_AT) : undefined,
      expiresAt: row.EXPIRES_AT ? new Date(row.EXPIRES_AT) : undefined,
      isActive: Number(row.IS_ACTIVE) === 1
    };
  }

  private async getOrCreateIdentityId(appId: number, userId: string): Promise<number> {
    const checkQuery = "SELECT IDENTITY_ID FROM PG_USER_IDENTITY WHERE APP_ID = :appId AND USER_ID = :userId";
    const checkRes = await OracleConnectionManager.execute(checkQuery, { appId, userId });
    if (checkRes.rows && checkRes.rows.length > 0) {
      return Number((checkRes.rows[0] as any).IDENTITY_ID);
    }

    const personEmail = `${userId.toLowerCase()}@placeholder.polygate.internal`;
    const checkPerson = "SELECT PERSON_ID FROM PG_PERSON WHERE EMAIL = :personEmail";
    const checkPersonRes = await OracleConnectionManager.execute(checkPerson, { personEmail });
    let personId: number;
    if (checkPersonRes.rows && checkPersonRes.rows.length > 0) {
      personId = Number((checkPersonRes.rows[0] as any).PERSON_ID);
    } else {
      const insertPerson = "INSERT INTO PG_PERSON (DISPLAY_NAME, EMAIL, STATUS, CREATED_AT, UPDATED_AT) VALUES (:userId, :personEmail, 'ACTIVE', SYSTIMESTAMP, SYSTIMESTAMP)";
      await OracleConnectionManager.execute(insertPerson, { userId, personEmail });
      const recheckPerson = await OracleConnectionManager.execute(checkPerson, { personEmail });
      personId = Number((recheckPerson.rows![0] as any).PERSON_ID);
    }

    const insertIdent = "INSERT INTO PG_USER_IDENTITY (PERSON_ID, APP_ID, USER_ID, CREATED_AT, UPDATED_AT) VALUES (:personId, :appId, :userId, SYSTIMESTAMP, SYSTIMESTAMP)";
    await OracleConnectionManager.execute(insertIdent, { personId, appId, userId });
    
    const recheckIdent = await OracleConnectionManager.execute(checkQuery, { appId, userId });
    return Number((recheckIdent.rows![0] as any).IDENTITY_ID);
  }

  public async saveSession(appId: number, session: SessionCredential): Promise<void> {
    const identityId = await this.getOrCreateIdentityId(appId, session.userId || "anonymous");
    const insertQuery = `
      INSERT INTO PG_SESSION_CREDENTIAL (
        IDENTITY_ID, COOKIE_PAYLOAD, HEADER_PAYLOAD, SESSION_UUID, CAPTURED_AT, EXPIRES_AT, IS_ACTIVE, CREATED_AT, UPDATED_AT
      ) VALUES (
        :identityId, :cookiePayload, :headerPayload, :sessionUuid, SYSTIMESTAMP, :expiresAt, :isActive, SYSTIMESTAMP, SYSTIMESTAMP
      )
    `;
    await OracleConnectionManager.execute(insertQuery, {
      identityId,
      cookiePayload: session.cookiePayload,
      headerPayload: session.headerPayload,
      sessionUuid: session.sessionUuid,
      expiresAt: session.expiresAt || null,
      isActive: session.isActive ? 1 : 0
    });
  }

  public async getActiveSession(appId: number, sessionUuidOrUserId?: string): Promise<SessionCredential | null> {
    let query = `
      SELECT s.SESSION_ID, i.APP_ID, s.COOKIE_PAYLOAD, s.HEADER_PAYLOAD, i.USER_ID, s.SESSION_UUID, s.CAPTURED_AT, s.EXPIRES_AT, s.IS_ACTIVE, s.IDENTITY_ID
      FROM PG_SESSION_CREDENTIAL s
      JOIN PG_USER_IDENTITY i ON s.IDENTITY_ID = i.IDENTITY_ID
      WHERE i.APP_ID = :appId AND s.IS_ACTIVE = 1
    `;
    const binds: any = { appId };
    if (sessionUuidOrUserId) {
      query += " AND (s.SESSION_UUID = :identifier OR i.USER_ID = :identifier)";
      binds.identifier = sessionUuidOrUserId;
    }
    query += " ORDER BY s.SESSION_ID DESC";

    const res = await OracleConnectionManager.execute(query, binds);
    if (res.rows && res.rows.length > 0) {
      return this.mapRow(res.rows[0]);
    }
    return null;
  }

  public async listSessions(appId: number): Promise<SessionCredential[]> {
    const query = `
      SELECT s.SESSION_ID, i.APP_ID, s.COOKIE_PAYLOAD, s.HEADER_PAYLOAD, i.USER_ID, s.SESSION_UUID, s.CAPTURED_AT, s.EXPIRES_AT, s.IS_ACTIVE, s.IDENTITY_ID
      FROM PG_SESSION_CREDENTIAL s
      JOIN PG_USER_IDENTITY i ON s.IDENTITY_ID = i.IDENTITY_ID
      WHERE i.APP_ID = :appId
      ORDER BY s.SESSION_ID DESC
    `;
    const res = await OracleConnectionManager.execute(query, { appId });
    if (res.rows) {
      return res.rows.map((row: any) => this.mapRow(row));
    }
    return [];
  }

  public async invalidate(sessionId: number): Promise<void> {
    const updateQuery = "UPDATE PG_SESSION_CREDENTIAL SET IS_ACTIVE = 0 WHERE SESSION_ID = :sessionId";
    await OracleConnectionManager.execute(updateQuery, { sessionId });
  }
}

export class OracleEndpointRepository implements IEndpointRepository {
  private mapRow(row: any): EndpointDefinition {
    return {
      id: Number(row.ENDPOINT_ID),
      appId: Number(row.APP_ID),
      versionId: row.VERSION_ID ? Number(row.VERSION_ID) : undefined,
      name: row.NAME,
      purposeId: row.PURPOSE_ID ? Number(row.PURPOSE_ID) : undefined,
      protocolType: row.PROTOCOL_TYPE as any,
      path: row.PATH || undefined,
      httpMethod: row.HTTP_METHOD as any,
      wsUrlPath: row.WS_URL_PATH || undefined,
      wsSubprotocol: row.WS_SUBPROTOCOL || undefined,
      wsMessageSchema: row.WS_MESSAGE_SCHEMA || undefined,
      requiresAuth: Number(row.REQUIRES_AUTH) === 1,
      requestHeaders: row.REQUEST_HEADERS ? JSON.parse(row.REQUEST_HEADERS) : undefined,
      requestBodySchema: row.REQUEST_BODY_SCHEMA ? JSON.parse(row.REQUEST_BODY_SCHEMA) : undefined,
      responseBodySchema: row.RESPONSE_BODY_SCHEMA ? JSON.parse(row.RESPONSE_BODY_SCHEMA) : undefined,
      sampleResponse: row.SAMPLE_RESPONSE ? JSON.parse(row.SAMPLE_RESPONSE) : undefined,
      description: row.DESCRIPTION,
      createdAt: row.CREATED_AT ? new Date(row.CREATED_AT) : undefined
    };
  }

  private async getOrCreateDefaultVersionId(appId: number): Promise<number> {
    const channelQuery = "SELECT CHANNEL_ID FROM PG_APP_ACCESS_CHANNEL WHERE APP_ID = :appId AND CHANNEL_TYPE = 'CUSTOMER'";
    let channelRes = await OracleConnectionManager.execute(channelQuery, { appId });
    let channelId: number;
    if (channelRes.rows && channelRes.rows.length > 0) {
      channelId = Number((channelRes.rows[0] as any).CHANNEL_ID);
    } else {
      const getAppUrl = "SELECT BASE_URL FROM PG_APPLICATION a LEFT JOIN PG_APP_ACCESS_CHANNEL c ON a.APP_ID = c.APP_ID AND c.CHANNEL_TYPE = 'CUSTOMER' WHERE a.APP_ID = :appId";
      const appUrlRes = await OracleConnectionManager.execute(getAppUrl, { appId });
      const baseUrl = appUrlRes.rows && appUrlRes.rows.length > 0 ? ((appUrlRes.rows[0] as any).BASE_URL || "http://localhost") : "http://localhost";
      const insertChannel = "INSERT INTO PG_APP_ACCESS_CHANNEL (APP_ID, CHANNEL_TYPE, BASE_URL, CREATED_AT, UPDATED_AT) VALUES (:appId, 'CUSTOMER', :baseUrl, SYSTIMESTAMP, SYSTIMESTAMP)";
      await OracleConnectionManager.execute(insertChannel, { appId, baseUrl });
      channelRes = await OracleConnectionManager.execute(channelQuery, { appId });
      channelId = Number((channelRes.rows![0] as any).CHANNEL_ID);
    }

    const versionQuery = "SELECT VERSION_ID FROM PG_APPLICATION_VERSION WHERE CHANNEL_ID = :channelId AND VERSION_LABEL = 'v1'";
    let versionRes = await OracleConnectionManager.execute(versionQuery, { channelId });
    if (versionRes.rows && versionRes.rows.length > 0) {
      return Number((versionRes.rows[0] as any).VERSION_ID);
    } else {
      const insertVersion = "INSERT INTO PG_APPLICATION_VERSION (CHANNEL_ID, VERSION_LABEL, EFFECTIVE_FROM, IS_CURRENT, CREATED_AT, UPDATED_AT) VALUES (:channelId, 'v1', SYSTIMESTAMP, 1, SYSTIMESTAMP, SYSTIMESTAMP)";
      await OracleConnectionManager.execute(insertVersion, { channelId });
      versionRes = await OracleConnectionManager.execute(versionQuery, { channelId });
      return Number((versionRes.rows![0] as any).VERSION_ID);
    }
  }

  private async getOrCreatePurposeId(name: string, method?: string): Promise<number> {
    let code = 'READ';
    const lowerName = name.toLowerCase();
    if (lowerName.includes("login")) code = 'LOGIN';
    else if (lowerName.includes("logout")) code = 'LOGOUT';
    else if (lowerName.includes("verify")) code = 'VERIFY';
    else if (method) {
      const upperMethod = method.toUpperCase();
      if (upperMethod === 'POST') code = 'CREATE';
      else if (upperMethod === 'PUT' || upperMethod === 'PATCH') code = 'UPDATE';
      else if (upperMethod === 'DELETE') code = 'DELETE';
    }
    const checkQuery = "SELECT PURPOSE_ID FROM PG_ENDPOINT_PURPOSE WHERE PURPOSE_CODE = :code";
    const checkRes = await OracleConnectionManager.execute(checkQuery, { code });
    if (checkRes.rows && checkRes.rows.length > 0) {
      return Number((checkRes.rows[0] as any).PURPOSE_ID);
    }
    const insertQuery = "INSERT INTO PG_ENDPOINT_PURPOSE (PURPOSE_CODE, DISPLAY_NAME, CREATED_AT, UPDATED_AT) VALUES (:code, :code, SYSTIMESTAMP, SYSTIMESTAMP)";
    await OracleConnectionManager.execute(insertQuery, { code });
    const recheck = await OracleConnectionManager.execute(checkQuery, { code });
    return Number((recheck.rows![0] as any).PURPOSE_ID);
  }

  public async list(appId: number): Promise<EndpointDefinition[]> {
    const query = `
      SELECT e.ENDPOINT_ID, v.VERSION_ID, e.NAME, e.PATH, e.HTTP_METHOD, e.REQUIRES_AUTH, e.REQUEST_HEADERS, e.REQUEST_BODY_SCHEMA, e.RESPONSE_BODY_SCHEMA, e.SAMPLE_RESPONSE, e.DESCRIPTION, e.CREATED_AT, e.PROTOCOL_TYPE, e.WS_URL_PATH, e.WS_SUBPROTOCOL, e.WS_MESSAGE_SCHEMA, c.APP_ID, e.PURPOSE_ID
      FROM PG_ENDPOINT_DEFINITION e
      JOIN PG_APPLICATION_VERSION v ON e.VERSION_ID = v.VERSION_ID
      JOIN PG_APP_ACCESS_CHANNEL c ON v.CHANNEL_ID = c.CHANNEL_ID
      WHERE c.APP_ID = :appId
      ORDER BY e.ENDPOINT_ID ASC
    `;
    const res = await OracleConnectionManager.execute(query, { appId });
    if (res.rows) {
      return res.rows.map(r => this.mapRow(r));
    }
    return [];
  }

  public async findByName(appId: number, name: string): Promise<EndpointDefinition | null> {
    const query = `
      SELECT e.ENDPOINT_ID, v.VERSION_ID, e.NAME, e.PATH, e.HTTP_METHOD, e.REQUIRES_AUTH, e.REQUEST_HEADERS, e.REQUEST_BODY_SCHEMA, e.RESPONSE_BODY_SCHEMA, e.SAMPLE_RESPONSE, e.DESCRIPTION, e.CREATED_AT, e.PROTOCOL_TYPE, e.WS_URL_PATH, e.WS_SUBPROTOCOL, e.WS_MESSAGE_SCHEMA, c.APP_ID, e.PURPOSE_ID
      FROM PG_ENDPOINT_DEFINITION e
      JOIN PG_APPLICATION_VERSION v ON e.VERSION_ID = v.VERSION_ID
      JOIN PG_APP_ACCESS_CHANNEL c ON v.CHANNEL_ID = c.CHANNEL_ID
      WHERE c.APP_ID = :appId AND LOWER(e.NAME) = LOWER(:name)
    `;
    const res = await OracleConnectionManager.execute(query, { appId, name });
    if (res.rows && res.rows.length > 0) {
      return this.mapRow(res.rows[0]);
    }
    return null;
  }

  public async upsert(def: EndpointDefinition): Promise<EndpointDefinition> {
    const versionId = def.versionId || await this.getOrCreateDefaultVersionId(def.appId);
    const purposeId = def.purposeId || await this.getOrCreatePurposeId(def.name, def.httpMethod);
    const protocolType = def.protocolType || 'HTTP';

    const mergeQuery = `
      MERGE INTO PG_ENDPOINT_DEFINITION target
      USING (
        SELECT
          :versionId AS VERSION_ID,
          :name AS NAME
        FROM dual
      ) source
      ON (target.VERSION_ID = source.VERSION_ID AND target.NAME = source.NAME)
      WHEN MATCHED THEN
        UPDATE SET
          PURPOSE_ID = :purposeId,
          PROTOCOL_TYPE = :protocolType,
          PATH = :path,
          HTTP_METHOD = :httpMethod,
          WS_URL_PATH = :wsUrlPath,
          WS_SUBPROTOCOL = :wsSubprotocol,
          WS_MESSAGE_SCHEMA = :wsMessageSchema,
          REQUIRES_AUTH = :requiresAuth,
          REQUEST_HEADERS = :requestHeaders,
          REQUEST_BODY_SCHEMA = :requestBodySchema,
          RESPONSE_BODY_SCHEMA = :responseBodySchema,
          SAMPLE_RESPONSE = :sampleResponse,
          DESCRIPTION = :description,
          UPDATED_AT = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (
          VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, PATH, HTTP_METHOD, WS_URL_PATH, WS_SUBPROTOCOL, WS_MESSAGE_SCHEMA, REQUIRES_AUTH, REQUEST_HEADERS, REQUEST_BODY_SCHEMA, RESPONSE_BODY_SCHEMA, SAMPLE_RESPONSE, DESCRIPTION, CREATED_AT, UPDATED_AT
        ) VALUES (
          source.VERSION_ID,
          source.NAME,
          :purposeId,
          :protocolType,
          :path,
          :httpMethod,
          :wsUrlPath,
          :wsSubprotocol,
          :wsMessageSchema,
          :requiresAuth,
          :requestHeaders,
          :requestBodySchema,
          :responseBodySchema,
          :sampleResponse,
          :description,
          SYSTIMESTAMP,
          SYSTIMESTAMP
        )
    `;

    await OracleConnectionManager.execute(mergeQuery, {
      versionId,
      name: def.name,
      purposeId,
      protocolType,
      path: def.path || null,
      httpMethod: def.httpMethod || null,
      wsUrlPath: def.wsUrlPath || null,
      wsSubprotocol: def.wsSubprotocol || null,
      wsMessageSchema: def.wsMessageSchema || null,
      requiresAuth: def.requiresAuth ? 1 : 0,
      requestHeaders: def.requestHeaders ? JSON.stringify(def.requestHeaders) : null,
      requestBodySchema: def.requestBodySchema ? JSON.stringify(def.requestBodySchema) : null,
      responseBodySchema: def.responseBodySchema ? JSON.stringify(def.responseBodySchema) : null,
      sampleResponse: def.sampleResponse ? JSON.stringify(def.sampleResponse) : null,
      description: def.description || null
    });

    const reloaded = await this.findByName(def.appId, def.name);
    if (!reloaded) {
      throw new Error(`Failed to find endpoint definition ${def.name} after Oracle upsert`);
    }
    return reloaded;
  }
}

export class OracleAuditLogRepository implements IAuditLogRepository {
  private async getOrCreateActionId(action: string): Promise<number> {
    const checkQuery = "SELECT ACTION_ID FROM PG_AUDIT_ACTION WHERE ACTION_CODE = :action";
    const checkRes = await OracleConnectionManager.execute(checkQuery, { action });
    if (checkRes.rows && checkRes.rows.length > 0) {
      return Number((checkRes.rows[0] as any).ACTION_ID);
    }
    const insertQuery = "INSERT INTO PG_AUDIT_ACTION (ACTION_CODE, DISPLAY_NAME, CREATED_AT, UPDATED_AT) VALUES (:action, :action, SYSTIMESTAMP, SYSTIMESTAMP)";
    await OracleConnectionManager.execute(insertQuery, { action });
    const recheck = await OracleConnectionManager.execute(checkQuery, { action });
    return Number((recheck.rows![0] as any).ACTION_ID);
  }

  public async save(log: AuditLog): Promise<AuditLog> {
    const actionId = await this.getOrCreateActionId(log.action);
    const insertQuery = `
      INSERT INTO PG_AUDIT_LOG (
        APP_ID, ENDPOINT_ID, PERSON_ID, IDENTITY_ID, SESSION_ID, ACTION_ID, STATUS_CODE, CORRELATION_ID, DETAIL, EXECUTED_AT, CREATED_AT, UPDATED_AT
      ) VALUES (
        :appId, :endpointId, :personId, :identityId, :sessionId, :actionId, :statusCode, :correlationId, :detail, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP
      )
    `;
    
    await OracleConnectionManager.execute(insertQuery, {
      appId: log.appId || null,
      endpointId: log.endpointId || null,
      personId: log.personId || null,
      identityId: log.identityId || null,
      sessionId: log.sessionId || null,
      actionId,
      statusCode: log.statusCode || null,
      correlationId: log.correlationId || null,
      detail: log.detail || null
    });
    
    return {
      ...log,
      executedAt: new Date()
    };
  }
}
