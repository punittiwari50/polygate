import { Application, EndpointDefinition } from "@polygate/core";

export interface WebsocketDefinition {
  appKey: string;
  name: string;
  path: string;
  protocols?: string[];
  description?: string;
}

export interface AssetDefinition {
  appKey: string;
  name: string;
  filePath: string;
  mimeType: string;
}

/**
 * Strategy base class for SQL Dialect DML/DDL generation.
 */
export abstract class SqlDialectGenerator {
  public abstract getDialectName(): string;
  public abstract generateDdl(): string;
  public abstract generateApplicationInsert(app: Application): string;
  public abstract generateEndpointInsert(appKey: string, ep: EndpointDefinition): string;
  public abstract generateWebsocketInsert(appKey: string, ws: WebsocketDefinition): string;
  public abstract generateAssetInsert(appKey: string, asset: AssetDefinition): string;

  protected escapeString(str: string | undefined | null): string {
    if (str === undefined || str === null) return "NULL";
    return `'${str.replace(/'/g, "''")}'`;
  }

  protected getAppIdSubSelect(appKey: string): string {
    return `(SELECT APP_ID FROM PG_APPLICATION WHERE APP_KEY = ${this.escapeString(appKey.toLowerCase())})`;
  }

  protected getVersionIdSubSelect(appKey: string): string {
    return `(SELECT VERSION_ID FROM PG_APPLICATION_VERSION WHERE CHANNEL_ID = (SELECT CHANNEL_ID FROM PG_APP_ACCESS_CHANNEL WHERE APP_ID = ${this.getAppIdSubSelect(appKey)} AND CHANNEL_TYPE = 'CUSTOMER') AND VERSION_LABEL = 'v1')`;
  }

  protected getPurposeIdSubQuery(name: string, method?: string): string {
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
    return `(SELECT PURPOSE_ID FROM PG_ENDPOINT_PURPOSE WHERE PURPOSE_CODE = '${code}')`;
  }
}

/**
 * PostgreSQL implementation.
 */
export class PostgresGenerator extends SqlDialectGenerator {
  public getDialectName(): string {
    return "postgres";
  }

  public generateDdl(): string {
    return `-- Seed Lookup Tables
INSERT INTO PG_APPLICATION_DOMAIN (DOMAIN_CODE, DISPLAY_NAME) VALUES ('OTHER', 'Other/General') ON CONFLICT (DOMAIN_CODE) DO NOTHING;
INSERT INTO PG_ENDPOINT_PURPOSE (PURPOSE_CODE, DISPLAY_NAME) VALUES ('LOGIN', 'Login'), ('LOGOUT', 'Logout'), ('VERIFY', 'Verify'), ('CREATE', 'Create'), ('READ', 'Read'), ('UPDATE', 'Update'), ('DELETE', 'Delete'), ('LIST', 'List') ON CONFLICT (PURPOSE_CODE) DO NOTHING;
INSERT INTO PG_AUDIT_ACTION (ACTION_CODE, DISPLAY_NAME) VALUES ('LOGIN', 'Login'), ('LOGOUT', 'Logout'), ('VERIFY', 'Verify'), ('PROXY', 'Proxy'), ('SEED', 'Seed') ON CONFLICT (ACTION_CODE) DO NOTHING;
`;
  }

  public generateApplicationInsert(app: Application): string {
    const rulesStr = app.sessionInjectionRules ? (typeof app.sessionInjectionRules === "string" ? app.sessionInjectionRules : JSON.stringify(app.sessionInjectionRules)) : null;
    return `-- Insert Application Record
INSERT INTO PG_APPLICATION (
    APP_KEY, DISPLAY_NAME, DOMAIN_ID, AUTH_TYPE, STATUS
) VALUES (
    ${this.escapeString(app.appKey)},
    ${this.escapeString(app.displayName)},
    (SELECT DOMAIN_ID FROM PG_APPLICATION_DOMAIN WHERE DOMAIN_CODE = 'OTHER' LIMIT 1),
    ${this.escapeString(app.authType)},
    ${this.escapeString(app.status)}
) ON CONFLICT (APP_KEY) DO UPDATE SET
    DISPLAY_NAME = EXCLUDED.DISPLAY_NAME,
    AUTH_TYPE = EXCLUDED.AUTH_TYPE,
    STATUS = EXCLUDED.STATUS,
    UPDATED_AT = CURRENT_TIMESTAMP;

-- Insert Application Channel
INSERT INTO PG_APP_ACCESS_CHANNEL (
    APP_ID, CHANNEL_TYPE, BASE_URL, LOGIN_URL, LOGIN_SUCCESS_URL_PATTERN, LOGIN_SUCCESS_COOKIE_NAME, SESSION_INJECTION_RULES, USER_ID_COOKIE_NAME, SESSION_CAPTURE_HEADERS
) VALUES (
    ${this.getAppIdSubSelect(app.appKey)},
    'CUSTOMER',
    ${this.escapeString(app.baseUrl)},
    ${this.escapeString(app.loginUrl)},
    ${this.escapeString(app.loginSuccessUrlPattern)},
    ${this.escapeString(app.loginSuccessCookieName)},
    ${this.escapeString(rulesStr)},
    ${this.escapeString(app.userIdCookieName)},
    ${this.escapeString(app.sessionCaptureHeaders)}
) ON CONFLICT (APP_ID, CHANNEL_TYPE) DO UPDATE SET
    BASE_URL = EXCLUDED.BASE_URL,
    LOGIN_URL = EXCLUDED.LOGIN_URL,
    LOGIN_SUCCESS_URL_PATTERN = EXCLUDED.LOGIN_SUCCESS_URL_PATTERN,
    LOGIN_SUCCESS_COOKIE_NAME = EXCLUDED.LOGIN_SUCCESS_COOKIE_NAME,
    SESSION_INJECTION_RULES = EXCLUDED.SESSION_INJECTION_RULES,
    USER_ID_COOKIE_NAME = EXCLUDED.USER_ID_COOKIE_NAME,
    SESSION_CAPTURE_HEADERS = EXCLUDED.SESSION_CAPTURE_HEADERS,
    UPDATED_AT = CURRENT_TIMESTAMP;

-- Insert Version Tracking
INSERT INTO PG_APPLICATION_VERSION (
    CHANNEL_ID, VERSION_LABEL, IS_CURRENT
) VALUES (
    (SELECT CHANNEL_ID FROM PG_APP_ACCESS_CHANNEL WHERE APP_ID = ${this.getAppIdSubSelect(app.appKey)} AND CHANNEL_TYPE = 'CUSTOMER'),
    'v1',
    TRUE
) ON CONFLICT (CHANNEL_ID, VERSION_LABEL) DO NOTHING;`;
  }

  public generateEndpointInsert(appKey: string, ep: EndpointDefinition): string {
    const headers = ep.requestHeaders ? JSON.stringify(ep.requestHeaders) : null;
    const reqSchema = ep.requestBodySchema ? JSON.stringify(ep.requestBodySchema) : null;
    const resSchema = ep.responseBodySchema ? JSON.stringify(ep.responseBodySchema) : null;
    const sampleRes = null;

    return `INSERT INTO PG_ENDPOINT_DEFINITION (
    VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, PATH, HTTP_METHOD, REQUIRES_AUTH, REQUEST_HEADERS, REQUEST_BODY_SCHEMA, RESPONSE_BODY_SCHEMA, SAMPLE_RESPONSE, DESCRIPTION
) VALUES (
    ${this.getVersionIdSubSelect(appKey)},
    ${this.escapeString(ep.name)},
    ${this.getPurposeIdSubQuery(ep.name, ep.httpMethod)},
    'HTTP',
    ${this.escapeString(ep.path)},
    ${this.escapeString(ep.httpMethod)},
    ${ep.requiresAuth ? 1 : 0},
    ${this.escapeString(headers)},
    ${this.escapeString(reqSchema)},
    ${this.escapeString(resSchema)},
    ${this.escapeString(sampleRes)},
    ${this.escapeString(ep.description)}
) ON CONFLICT (VERSION_ID, NAME) DO UPDATE SET
    PATH = EXCLUDED.PATH,
    HTTP_METHOD = EXCLUDED.HTTP_METHOD,
    REQUIRES_AUTH = EXCLUDED.REQUIRES_AUTH,
    REQUEST_HEADERS = EXCLUDED.REQUEST_HEADERS,
    REQUEST_BODY_SCHEMA = EXCLUDED.REQUEST_BODY_SCHEMA,
    RESPONSE_BODY_SCHEMA = EXCLUDED.RESPONSE_BODY_SCHEMA,
    SAMPLE_RESPONSE = EXCLUDED.SAMPLE_RESPONSE,
    DESCRIPTION = EXCLUDED.DESCRIPTION;`;
  }

  public generateWebsocketInsert(appKey: string, ws: WebsocketDefinition): string {
    return `-- Insert WebSocket as Endpoint Definition
INSERT INTO PG_ENDPOINT_DEFINITION (
    VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, WS_URL_PATH, REQUIRES_AUTH, DESCRIPTION
) VALUES (
    ${this.getVersionIdSubSelect(appKey)},
    ${this.escapeString(ws.name)},
    (SELECT PURPOSE_ID FROM PG_ENDPOINT_PURPOSE WHERE PURPOSE_CODE = 'READ' LIMIT 1),
    'WEBSOCKET',
    ${this.escapeString(ws.path)},
    1,
    ${this.escapeString(ws.description)}
) ON CONFLICT (VERSION_ID, NAME) DO UPDATE SET
    WS_URL_PATH = EXCLUDED.WS_URL_PATH,
    DESCRIPTION = EXCLUDED.DESCRIPTION;`;
  }

  public generateAssetInsert(appKey: string, asset: AssetDefinition): string {
    return `-- Asset mapping bypassed (Schema consolidated)`;
  }
}

/**
 * MySQL implementation.
 */
export class MysqlGenerator extends SqlDialectGenerator {
  public getDialectName(): string {
    return "mysql";
  }

  public generateDdl(): string {
    return `-- Seed Lookup Tables
INSERT IGNORE INTO PG_APPLICATION_DOMAIN (DOMAIN_CODE, DISPLAY_NAME) VALUES ('OTHER', 'Other/General');
INSERT IGNORE INTO PG_ENDPOINT_PURPOSE (PURPOSE_CODE, DISPLAY_NAME) VALUES ('LOGIN', 'Login'), ('LOGOUT', 'Logout'), ('VERIFY', 'Verify'), ('CREATE', 'Create'), ('READ', 'Read'), ('UPDATE', 'Update'), ('DELETE', 'Delete'), ('LIST', 'List');
INSERT IGNORE INTO PG_AUDIT_ACTION (ACTION_CODE, DISPLAY_NAME) VALUES ('LOGIN', 'Login'), ('LOGOUT', 'Logout'), ('VERIFY', 'Verify'), ('PROXY', 'Proxy'), ('SEED', 'Seed');
`;
  }

  public generateApplicationInsert(app: Application): string {
    const rulesStr = app.sessionInjectionRules ? (typeof app.sessionInjectionRules === "string" ? app.sessionInjectionRules : JSON.stringify(app.sessionInjectionRules)) : null;
    return `-- Insert Application Record
INSERT INTO PG_APPLICATION (
    APP_KEY, DISPLAY_NAME, DOMAIN_ID, AUTH_TYPE, STATUS
) VALUES (
    ${this.escapeString(app.appKey)},
    ${this.escapeString(app.displayName)},
    (SELECT DOMAIN_ID FROM PG_APPLICATION_DOMAIN WHERE DOMAIN_CODE = 'OTHER' LIMIT 1),
    ${this.escapeString(app.authType)},
    ${this.escapeString(app.status)}
) ON DUPLICATE KEY UPDATE
    DISPLAY_NAME = VALUES(DISPLAY_NAME),
    AUTH_TYPE = VALUES(AUTH_TYPE),
    STATUS = VALUES(STATUS),
    UPDATED_AT = CURRENT_TIMESTAMP;

-- Insert Application Channel
INSERT INTO PG_APP_ACCESS_CHANNEL (
    APP_ID, CHANNEL_TYPE, BASE_URL, LOGIN_URL, LOGIN_SUCCESS_URL_PATTERN, LOGIN_SUCCESS_COOKIE_NAME, SESSION_INJECTION_RULES, USER_ID_COOKIE_NAME, SESSION_CAPTURE_HEADERS
) VALUES (
    ${this.getAppIdSubSelect(app.appKey)},
    'CUSTOMER',
    ${this.escapeString(app.baseUrl)},
    ${this.escapeString(app.loginUrl)},
    ${this.escapeString(app.loginSuccessUrlPattern)},
    ${this.escapeString(app.loginSuccessCookieName)},
    ${this.escapeString(rulesStr)},
    ${this.escapeString(app.userIdCookieName)},
    ${this.escapeString(app.sessionCaptureHeaders)}
) ON DUPLICATE KEY UPDATE
    BASE_URL = VALUES(BASE_URL),
    LOGIN_URL = VALUES(LOGIN_URL),
    LOGIN_SUCCESS_URL_PATTERN = VALUES(LOGIN_SUCCESS_URL_PATTERN),
    LOGIN_SUCCESS_COOKIE_NAME = VALUES(LOGIN_SUCCESS_COOKIE_NAME),
    SESSION_INJECTION_RULES = VALUES(SESSION_INJECTION_RULES),
    USER_ID_COOKIE_NAME = VALUES(USER_ID_COOKIE_NAME),
    SESSION_CAPTURE_HEADERS = VALUES(SESSION_CAPTURE_HEADERS),
    UPDATED_AT = CURRENT_TIMESTAMP;

-- Insert Version Tracking
INSERT IGNORE INTO PG_APPLICATION_VERSION (
    CHANNEL_ID, VERSION_LABEL, IS_CURRENT
) VALUES (
    (SELECT CHANNEL_ID FROM PG_APP_ACCESS_CHANNEL WHERE APP_ID = ${this.getAppIdSubSelect(app.appKey)} AND CHANNEL_TYPE = 'CUSTOMER'),
    'v1',
    TRUE
);`;
  }

  public generateEndpointInsert(appKey: string, ep: EndpointDefinition): string {
    const headers = ep.requestHeaders ? JSON.stringify(ep.requestHeaders) : null;
    const reqSchema = ep.requestBodySchema ? JSON.stringify(ep.requestBodySchema) : null;
    const resSchema = ep.responseBodySchema ? JSON.stringify(ep.responseBodySchema) : null;
    const sampleRes = null;

    return `INSERT INTO PG_ENDPOINT_DEFINITION (
    VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, PATH, HTTP_METHOD, REQUIRES_AUTH, REQUEST_HEADERS, REQUEST_BODY_SCHEMA, RESPONSE_BODY_SCHEMA, SAMPLE_RESPONSE, DESCRIPTION
) VALUES (
    ${this.getVersionIdSubSelect(appKey)},
    ${this.escapeString(ep.name)},
    ${this.getPurposeIdSubQuery(ep.name, ep.httpMethod)},
    'HTTP',
    ${this.escapeString(ep.path)},
    ${this.escapeString(ep.httpMethod)},
    ${ep.requiresAuth ? 1 : 0},
    ${this.escapeString(headers)},
    ${this.escapeString(reqSchema)},
    ${this.escapeString(resSchema)},
    ${this.escapeString(sampleRes)},
    ${this.escapeString(ep.description)}
) ON DUPLICATE KEY UPDATE
    PATH = VALUES(PATH),
    HTTP_METHOD = VALUES(HTTP_METHOD),
    REQUIRES_AUTH = VALUES(REQUIRES_AUTH),
    REQUEST_HEADERS = VALUES(REQUEST_HEADERS),
    REQUEST_BODY_SCHEMA = VALUES(REQUEST_BODY_SCHEMA),
    RESPONSE_BODY_SCHEMA = VALUES(RESPONSE_BODY_SCHEMA),
    SAMPLE_RESPONSE = VALUES(SAMPLE_RESPONSE),
    DESCRIPTION = VALUES(DESCRIPTION);`;
  }

  public generateWebsocketInsert(appKey: string, ws: WebsocketDefinition): string {
    return `-- Insert WebSocket as Endpoint Definition
INSERT INTO PG_ENDPOINT_DEFINITION (
    VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, WS_URL_PATH, REQUIRES_AUTH, DESCRIPTION
) VALUES (
    ${this.getVersionIdSubSelect(appKey)},
    ${this.escapeString(ws.name)},
    (SELECT PURPOSE_ID FROM PG_ENDPOINT_PURPOSE WHERE PURPOSE_CODE = 'READ' LIMIT 1),
    'WEBSOCKET',
    ${this.escapeString(ws.path)},
    1,
    ${this.escapeString(ws.description)}
) ON DUPLICATE KEY UPDATE
    WS_URL_PATH = VALUES(WS_URL_PATH),
    DESCRIPTION = VALUES(DESCRIPTION);`;
  }

  public generateAssetInsert(appKey: string, asset: AssetDefinition): string {
    return `-- Asset mapping bypassed (Schema consolidated)`;
  }
}

/**
 * Oracle implementation.
 */
export class OracleGenerator extends SqlDialectGenerator {
  public getDialectName(): string {
    return "oracle";
  }

  public generateDdl(): string {
    return `-- Seed Lookup Tables
MERGE INTO PG_APPLICATION_DOMAIN target
USING (SELECT 'OTHER' AS DOMAIN_CODE, 'Other/General' AS DISPLAY_NAME FROM dual) source
ON (target.DOMAIN_CODE = source.DOMAIN_CODE)
WHEN NOT MATCHED THEN
    INSERT (DOMAIN_CODE, DISPLAY_NAME, CREATED_AT, UPDATED_AT) VALUES (source.DOMAIN_CODE, source.DISPLAY_NAME, SYSTIMESTAMP, SYSTIMESTAMP);

-- Pre-seed purposes
-- Note: Oracle loops or individual merges
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'LOGIN' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('LOGIN', 'Login');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'LOGOUT' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('LOGOUT', 'Logout');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'VERIFY' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('VERIFY', 'Verify');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'CREATE' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('CREATE', 'Create');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'READ' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('READ', 'Read');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'UPDATE' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('UPDATE', 'Update');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'DELETE' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('DELETE', 'Delete');
MERGE INTO PG_ENDPOINT_PURPOSE target USING (SELECT 'LIST' AS CODE FROM dual) src ON (target.PURPOSE_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (PURPOSE_CODE, DISPLAY_NAME) VALUES ('LIST', 'List');

-- Pre-seed audit actions
MERGE INTO PG_AUDIT_ACTION target USING (SELECT 'LOGIN' AS CODE FROM dual) src ON (target.ACTION_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (ACTION_CODE, DISPLAY_NAME) VALUES ('LOGIN', 'Login');
MERGE INTO PG_AUDIT_ACTION target USING (SELECT 'LOGOUT' AS CODE FROM dual) src ON (target.ACTION_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (ACTION_CODE, DISPLAY_NAME) VALUES ('LOGOUT', 'Logout');
MERGE INTO PG_AUDIT_ACTION target USING (SELECT 'VERIFY' AS CODE FROM dual) src ON (target.ACTION_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (ACTION_CODE, DISPLAY_NAME) VALUES ('VERIFY', 'Verify');
MERGE INTO PG_AUDIT_ACTION target USING (SELECT 'PROXY' AS CODE FROM dual) src ON (target.ACTION_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (ACTION_CODE, DISPLAY_NAME) VALUES ('PROXY', 'Proxy');
MERGE INTO PG_AUDIT_ACTION target USING (SELECT 'SEED' AS CODE FROM dual) src ON (target.ACTION_CODE = src.CODE) WHEN NOT MATCHED THEN INSERT (ACTION_CODE, DISPLAY_NAME) VALUES ('SEED', 'Seed');
`;
  }

  public generateApplicationInsert(app: Application): string {
    const rulesStr = app.sessionInjectionRules ? (typeof app.sessionInjectionRules === "string" ? app.sessionInjectionRules : JSON.stringify(app.sessionInjectionRules)) : null;
    return `-- Insert Application Record
MERGE INTO PG_APPLICATION target
USING (SELECT ${this.escapeString(app.appKey)} AS APP_KEY FROM dual) source
ON (target.APP_KEY = source.APP_KEY)
WHEN MATCHED THEN
    UPDATE SET
        DISPLAY_NAME = ${this.escapeString(app.displayName)},
        AUTH_TYPE = ${this.escapeString(app.authType)},
        STATUS = ${this.escapeString(app.status)},
        UPDATED_AT = SYSTIMESTAMP
WHEN NOT MATCHED THEN
    INSERT (
        APP_KEY, DISPLAY_NAME, DOMAIN_ID, AUTH_TYPE, STATUS, CREATED_AT, UPDATED_AT
    ) VALUES (
        ${this.escapeString(app.appKey)},
        ${this.escapeString(app.displayName)},
        (SELECT DOMAIN_ID FROM PG_APPLICATION_DOMAIN WHERE DOMAIN_CODE = 'OTHER'),
        ${this.escapeString(app.authType)},
        ${this.escapeString(app.status)},
        SYSTIMESTAMP,
        SYSTIMESTAMP
    );

-- Insert Application Channel
MERGE INTO PG_APP_ACCESS_CHANNEL target
USING (
    SELECT
        ${this.getAppIdSubSelect(app.appKey)} AS APP_ID,
        'CUSTOMER' AS CHANNEL_TYPE
    FROM dual
) source
ON (target.APP_ID = source.APP_ID AND target.CHANNEL_TYPE = source.CHANNEL_TYPE)
WHEN MATCHED THEN
    UPDATE SET
        BASE_URL = ${this.escapeString(app.baseUrl)},
        LOGIN_URL = ${this.escapeString(app.loginUrl)},
        LOGIN_SUCCESS_URL_PATTERN = ${this.escapeString(app.loginSuccessUrlPattern)},
        LOGIN_SUCCESS_COOKIE_NAME = ${this.escapeString(app.loginSuccessCookieName)},
        SESSION_INJECTION_RULES = ${this.escapeString(rulesStr)},
        USER_ID_COOKIE_NAME = ${this.escapeString(app.userIdCookieName)},
        SESSION_CAPTURE_HEADERS = ${this.escapeString(app.sessionCaptureHeaders)},
        UPDATED_AT = SYSTIMESTAMP
WHEN NOT MATCHED THEN
    INSERT (
        APP_ID, CHANNEL_TYPE, BASE_URL, LOGIN_URL, LOGIN_SUCCESS_URL_PATTERN, LOGIN_SUCCESS_COOKIE_NAME, SESSION_INJECTION_RULES, USER_ID_COOKIE_NAME, SESSION_CAPTURE_HEADERS, CREATED_AT, UPDATED_AT
    ) VALUES (
        source.APP_ID,
        source.CHANNEL_TYPE,
        ${this.escapeString(app.baseUrl)},
        ${this.escapeString(app.loginUrl)},
        ${this.escapeString(app.loginSuccessUrlPattern)},
        ${this.escapeString(app.loginSuccessCookieName)},
        ${this.escapeString(rulesStr)},
        ${this.escapeString(app.userIdCookieName)},
        ${this.escapeString(app.sessionCaptureHeaders)},
        SYSTIMESTAMP,
        SYSTIMESTAMP
    );

-- Insert Version Tracking
MERGE INTO PG_APPLICATION_VERSION target
USING (
    SELECT
        (SELECT CHANNEL_ID FROM PG_APP_ACCESS_CHANNEL WHERE APP_ID = ${this.getAppIdSubSelect(app.appKey)} AND CHANNEL_TYPE = 'CUSTOMER') AS CHANNEL_ID,
        'v1' AS VERSION_LABEL
    FROM dual
) source
ON (target.CHANNEL_ID = source.CHANNEL_ID AND target.VERSION_LABEL = source.VERSION_LABEL)
WHEN NOT MATCHED THEN
    INSERT (CHANNEL_ID, VERSION_LABEL, IS_CURRENT, CREATED_AT, UPDATED_AT)
    VALUES (source.CHANNEL_ID, source.VERSION_LABEL, 1, SYSTIMESTAMP, SYSTIMESTAMP);`;
  }

  public generateEndpointInsert(appKey: string, ep: EndpointDefinition): string {
    const headers = ep.requestHeaders ? JSON.stringify(ep.requestHeaders) : null;
    const reqSchema = ep.requestBodySchema ? JSON.stringify(ep.requestBodySchema) : null;
    const resSchema = ep.responseBodySchema ? JSON.stringify(ep.responseBodySchema) : null;
    const sampleRes = null;

    return `MERGE INTO PG_ENDPOINT_DEFINITION target
USING (
    SELECT
        ${this.getVersionIdSubSelect(appKey)} AS VERSION_ID,
        ${this.escapeString(ep.name)} AS NAME
    FROM dual
) source
ON (target.VERSION_ID = source.VERSION_ID AND target.NAME = source.NAME)
WHEN MATCHED THEN
    UPDATE SET
        PATH = ${this.escapeString(ep.path)},
        HTTP_METHOD = ${this.escapeString(ep.httpMethod)},
        REQUIRES_AUTH = ${ep.requiresAuth ? 1 : 0},
        REQUEST_HEADERS = ${this.escapeString(headers)},
        REQUEST_BODY_SCHEMA = ${this.escapeString(reqSchema)},
        RESPONSE_BODY_SCHEMA = ${this.escapeString(resSchema)},
        SAMPLE_RESPONSE = ${this.escapeString(sampleRes)},
        DESCRIPTION = ${this.escapeString(ep.description)},
        UPDATED_AT = SYSTIMESTAMP
WHEN NOT MATCHED THEN
    INSERT (
        VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, PATH, HTTP_METHOD, REQUIRES_AUTH, REQUEST_HEADERS, REQUEST_BODY_SCHEMA, RESPONSE_BODY_SCHEMA, SAMPLE_RESPONSE, DESCRIPTION, CREATED_AT, UPDATED_AT
    ) VALUES (
        source.VERSION_ID,
        source.NAME,
        ${this.getPurposeIdSubQuery(ep.name, ep.httpMethod)},
        'HTTP',
        ${this.escapeString(ep.path)},
        ${this.escapeString(ep.httpMethod)},
        ${ep.requiresAuth ? 1 : 0},
        ${this.escapeString(headers)},
        ${this.escapeString(reqSchema)},
        ${this.escapeString(resSchema)},
        ${this.escapeString(sampleRes)},
        ${this.escapeString(ep.description)},
        SYSTIMESTAMP,
        SYSTIMESTAMP
    );`;
  }

  public generateWebsocketInsert(appKey: string, ws: WebsocketDefinition): string {
    return `MERGE INTO PG_ENDPOINT_DEFINITION target
USING (
    SELECT
        ${this.getVersionIdSubSelect(appKey)} AS VERSION_ID,
        ${this.escapeString(ws.name)} AS NAME
    FROM dual
) source
ON (target.VERSION_ID = source.VERSION_ID AND target.NAME = source.NAME)
WHEN MATCHED THEN
    UPDATE SET
        WS_URL_PATH = ${this.escapeString(ws.path)},
        DESCRIPTION = ${this.escapeString(ws.description)},
        UPDATED_AT = SYSTIMESTAMP
WHEN NOT MATCHED THEN
    INSERT (
        VERSION_ID, NAME, PURPOSE_ID, PROTOCOL_TYPE, WS_URL_PATH, REQUIRES_AUTH, DESCRIPTION, CREATED_AT, UPDATED_AT
    ) VALUES (
        source.VERSION_ID,
        source.NAME,
        (SELECT PURPOSE_ID FROM PG_ENDPOINT_PURPOSE WHERE PURPOSE_CODE = 'READ'),
        'WEBSOCKET',
        ${this.escapeString(ws.path)},
        1,
        ${this.escapeString(ws.description)},
        SYSTIMESTAMP,
        SYSTIMESTAMP
    );`;
  }

  public generateAssetInsert(appKey: string, asset: AssetDefinition): string {
    return `-- Asset mapping bypassed (Schema consolidated)`;
  }
}
