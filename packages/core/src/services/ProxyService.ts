import { injectable, inject } from "tsyringe";
import { AppService } from "@/services/AppService.js";
import { SessionService } from "@/services/SessionService.js";
import { EndpointService } from "@/services/EndpointService.js";
import { AuditLogService } from "@/services/AuditLogService.js";
import { EndpointDefinition } from "@/entities/EndpointDefinition.js";
import { Application, USER_ID_FALLBACK_NAMES, matchesCaptureHeaders } from "@/entities/Application.js";

export interface ProxyRequest {
  method: string;
  path: string; // e.g. /some/subpath
  queryParams: Record<string, any>;
  headers: Record<string, string>;
  body?: any;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  validationError?: string;
}

// --- Design Pattern: Chain of Responsibility for resolving User ID ---

interface IUserIdResolver {
  setNext(resolver: IUserIdResolver): IUserIdResolver;
  resolve(app: Application, headers: Record<string, string>): string | undefined;
}

abstract class AbstractUserIdResolver implements IUserIdResolver {
  private nextResolver?: IUserIdResolver;

  public setNext(resolver: IUserIdResolver): IUserIdResolver {
    this.nextResolver = resolver;
    return resolver;
  }

  public resolve(app: Application, headers: Record<string, string>): string | undefined {
    const result = this.doResolve(app, headers);
    if (result) {
      return result;
    }
    return this.nextResolver?.resolve(app, headers);
  }

  protected abstract doResolve(app: Application, headers: Record<string, string>): string | undefined;
}

class AppCookieResolver extends AbstractUserIdResolver {
  protected doResolve(app: Application, headers: Record<string, string>): string | undefined {
    const cookieHeader = headers["cookie"];
    if (app.userIdCookieName && cookieHeader) {
      const cookiesList = cookieHeader.split(";").map(c => c.trim().split("="));
      const found = cookiesList.find(([name]) => name === app.userIdCookieName);
      if (found) return found[1];
    }
    return undefined;
  }
}


class FallbackHeaderResolver extends AbstractUserIdResolver {
  protected doResolve(app: Application, headers: Record<string, string>): string | undefined {
    return headers["x-polygate-session-uuid"] || headers["x-polygate-userid"];
  }
}

class FallbackCookieResolver extends AbstractUserIdResolver {
  protected doResolve(app: Application, headers: Record<string, string>): string | undefined {
    const cookieHeader = headers["cookie"];
    if (cookieHeader) {
      const cookiesList = cookieHeader.split(";").map(c => c.trim().split("="));
      const found = cookiesList.find(([name]) => USER_ID_FALLBACK_NAMES.includes(name.toLowerCase()));
      if (found) return found[1];
    }
    return undefined;
  }
}

// --- Design Pattern: Strategy Pattern & Registry for Rule Injection ---

interface IRuleInjectionStrategy {
  inject(
    rule: any,
    session: { cookies: any[]; headers: Record<string, string> },
    finalHeaders: Record<string, string>
  ): void;
}

class CookieRuleStrategy implements IRuleInjectionStrategy {
  public inject(
    rule: any,
    session: { cookies: any[]; headers: Record<string, string> },
    finalHeaders: Record<string, string>
  ): void {
    const cookie = session.cookies.find(c => c.name === rule.sourceName);
    if (cookie && cookie.value) {
      let finalVal = cookie.value;
      if (rule.template) {
        finalVal = rule.template.replace("{value}", cookie.value);
      }
      finalHeaders[rule.name.toLowerCase()] = finalVal;
    }
  }
}

class StaticRuleStrategy implements IRuleInjectionStrategy {
  public inject(
    rule: any,
    session: { cookies: any[]; headers: Record<string, string> },
    finalHeaders: Record<string, string>
  ): void {
    finalHeaders[rule.name.toLowerCase()] = rule.value;
  }
}

class HeaderRuleStrategy implements IRuleInjectionStrategy {
  public inject(
    rule: any,
    session: { cookies: any[]; headers: Record<string, string> },
    finalHeaders: Record<string, string>
  ): void {
    const headerVal = session.headers[rule.sourceName] || session.headers[rule.sourceName.toLowerCase()];
    if (headerVal) {
      let finalVal = headerVal;
      if (rule.template) {
        finalVal = rule.template.replace("{value}", headerVal);
      }
      finalHeaders[rule.name.toLowerCase()] = finalVal;
    }
  }
}

const ruleStrategies: Record<string, IRuleInjectionStrategy> = {
  cookie: new CookieRuleStrategy(),
  static: new StaticRuleStrategy(),
  header: new HeaderRuleStrategy()
};

function interpolateValue(val: string): string {
  if (typeof val !== "string") return val;
  let resolved = val;
  if (resolved.startsWith("env:")) {
    const varName = resolved.substring(4).trim();
    return process.env[varName] || "";
  }
  const regex = /\${([A-Za-z0-9_]+)}/g;
  resolved = resolved.replace(regex, (_, varName) => {
    return process.env[varName] || "";
  });
  return resolved;
}

@injectable()
export class ProxyService {
  constructor(
    private appService: AppService,
    private sessionService: SessionService,
    private endpointService: EndpointService,
    private auditLogService: AuditLogService
  ) {}

  /**
   * Proxies an HTTP request to the configured upstream baseUrl for the app key.
   */
  public async proxy(appKey: string, req: ProxyRequest): Promise<ProxyResponse> {
    const app = await this.appService.getAppByKey(appKey);
    if (!app || !app.id) {
      throw new Error(`Application with key ${appKey} not found.`);
    }

    if (app.status === "DISABLED") {
      return {
        statusCode: 403,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "Application is disabled" }))
      };
    }

    // 1. Find matching endpoint definition (optional validation)
    const endpoints = await this.endpointService.listEndpoints(appKey);
    const matchedEndpoint = endpoints.find(e => 
      e.httpMethod && e.path &&
      e.httpMethod.toUpperCase() === req.method.toUpperCase() &&
      this.matchPath(e.path, req.path)
    );

    // 2. Validate mandatory headers and request body against schema if defined
    const missingHeaders: string[] = [];
    if (matchedEndpoint?.requestHeaders) {
      for (const [headerName, expectedVal] of Object.entries(matchedEndpoint.requestHeaders)) {
        if (expectedVal && expectedVal.toLowerCase() === "required") {
          const hasHeader = Object.keys(req.headers).some(
            h => h.toLowerCase() === headerName.toLowerCase()
          );
          if (!hasHeader) {
            missingHeaders.push(headerName);
          }
        }
      }
    }

    let bodyValidationError: string | null = null;
    if (matchedEndpoint?.requestBodySchema) {
      const bodyToValidate = req.body || {};
      bodyValidationError = this.validateJsonSchema(bodyToValidate, matchedEndpoint.requestBodySchema);
    }

    if (missingHeaders.length > 0 || bodyValidationError) {
      const errors: string[] = [];
      if (missingHeaders.length > 0) {
        errors.push(`Missing required header fields: ${missingHeaders.join(", ")}`);
      }
      if (bodyValidationError) {
        errors.push(`Request validation failed: ${bodyValidationError}`);
      }
      const errorMsg = errors.join("; ");

      console.error(`Validation Error for endpoint [${req.method}] ${req.path}: ${errorMsg}`);

      await this.auditLogService.logAction("PROXY", {
        appId: app.id,
        endpointId: matchedEndpoint?.id,
        statusCode: 400,
        detail: errorMsg
      });

      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: errorMsg }))
      };
    }

    // Normalize all incoming header keys to lowercase to prevent duplicates or capitalization mismatches
    const finalHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        finalHeaders[key.toLowerCase()] = interpolateValue(value);
      }
    }

    // 3. Resolve active session using Chain of Responsibility Pattern
    const resolverChain = new AppCookieResolver();
    resolverChain
      .setNext(new FallbackHeaderResolver())
      .setNext(new FallbackCookieResolver());

    const userId = resolverChain.resolve(app, finalHeaders);
    const session = await this.sessionService.getActiveSession(appKey, userId);

    // Redact secrets in final headers mapping or local logs
    delete finalHeaders["host"];
    delete finalHeaders["connection"];
    delete finalHeaders["content-length"];

    if (session) {
      // Inject session headers
      for (const [key, value] of Object.entries(session.headers)) {
        if (matchesCaptureHeaders(key, app.sessionCaptureHeaders)) {
          finalHeaders[key.toLowerCase()] = value;
        }
      }

      // Inject cookie header
      if (session.cookies && session.cookies.length > 0) {
        const cookieStr = session.cookies
          .map(c => `${c.name}=${c.value}`)
          .join("; ");
        
        const existingCookie = finalHeaders["cookie"];
        finalHeaders["cookie"] = existingCookie 
          ? `${existingCookie}; ${cookieStr}`
          : cookieStr;
      }

      // Process dynamic injection rules using Strategy Pattern Registry
      if (app.sessionInjectionRules) {
        try {
          const rules = typeof app.sessionInjectionRules === "string"
            ? JSON.parse(app.sessionInjectionRules)
            : app.sessionInjectionRules;

          if (rules && Array.isArray(rules.headers)) {
            for (const rule of rules.headers) {
              const strategy = ruleStrategies[rule.source];
              if (strategy) {
                strategy.inject(rule, session, finalHeaders);
              }
            }
          }
        } catch (e) {
          // ignore parsing/mapping errors
        }
      }
    }

    // Remove any placeholder "required" headers that were not overridden by client or session
    for (const [key, value] of Object.entries(finalHeaders)) {
      if (value === "required") {
        delete finalHeaders[key];
      }
    }

    // 4. Construct downstream URL
    let normalizedBaseUrl = app.baseUrl.trim();
    if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
      normalizedBaseUrl = `http://${normalizedBaseUrl}`;
    }
    const cleanBaseUrl = normalizedBaseUrl.replace(/\/$/, "");
    const cleanPath = req.path.startsWith("/") ? req.path : `/${req.path}`;
    const interpolatedBaseUrl = interpolateValue(cleanBaseUrl);
    const interpolatedPath = interpolateValue(cleanPath);
    const urlObj = new URL(`${interpolatedBaseUrl}${interpolatedPath}`);
    
    for (const [k, v] of Object.entries(req.queryParams)) {
      if (v !== undefined) {
        urlObj.searchParams.append(k, interpolateValue(String(v)));
      }
    }

    const targetUrl = interpolateValue(urlObj.toString());

    // 5. Perform the request
    let response: Response;
    try {
      const fetchOpts: RequestInit = {
        method: req.method,
        headers: finalHeaders,
        redirect: "manual" // Handle redirects transparently at gateway server or let client handle
      };

      if (req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined) {
        const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        fetchOpts.body = interpolateValue(rawBody);
      }

      response = await fetch(targetUrl, fetchOpts);
    } catch (err: any) {
      await this.auditLogService.logAction("PROXY", {
        appId: app.id,
        endpointId: matchedEndpoint?.id,
        statusCode: 502,
        detail: `Failed to connect upstream: ${err.message}`
      });
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: `Bad Gateway: ${err.message}` }))
      };
    }

    const responseBody = await response.arrayBuffer();
    const responseBuffer = Buffer.from(responseBody);

    // Convert response headers
    const resHeaders: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    let validationError: string | undefined;

    // 6. Validate response body if matched and response is successful (2xx)
    if (matchedEndpoint?.responseBodySchema && response.status >= 200 && response.status < 300) {
      try {
        const jsonBody = JSON.parse(responseBuffer.toString("utf8"));
        const valError = this.validateJsonSchema(jsonBody, matchedEndpoint.responseBodySchema);
        if (valError) {
          validationError = `Response body validation failed: ${valError}`;
        }
      } catch (e: any) {
        validationError = `Response is not valid JSON, schema validation skipped or failed: ${e.message}`;
      }
    }

    // 7. Audit log the proxy request
    await this.auditLogService.logAction("PROXY", {
      appId: app.id,
      endpointId: matchedEndpoint?.id,
      statusCode: response.status,
      detail: validationError ? `Validation error: ${validationError}` : `Proxied ${req.method} ${targetUrl}`
    });

    // --- SECURE PROXY REQUEST/RESPONSE LOGGING ---
    try {
      const secureReqHeaders = { ...finalHeaders };
      if (secureReqHeaders["cookie"]) {
        secureReqHeaders["cookie"] = this.redactCookieString(secureReqHeaders["cookie"]);
      }
      const redactedReqHeaders = this.redactHeaders(secureReqHeaders);
      const redactedResHeaders = this.redactHeaders(resHeaders);

      let printedReqBody = "None";
      if (req.body !== undefined) {
        printedReqBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }

      let printedResBody = "None";
      const contentType = resHeaders["content-type"] || "";
      if (
        contentType.includes("json") ||
        contentType.includes("text") ||
        contentType.includes("javascript") ||
        contentType.includes("html") ||
        contentType.includes("xml")
      ) {
        printedResBody = responseBuffer.toString("utf8");
        if (printedResBody.length > 2000) {
          printedResBody = printedResBody.slice(0, 2000) + "... [TRUNCATED]";
        }
      } else {
        printedResBody = `Binary data (${responseBuffer.length} bytes)`;
      }

      console.log(
        `\n=== PROXY REQUEST TRACE ===\n` +
        `URL: ${targetUrl}\n` +
        `Method: ${req.method}\n` +
        `Request Headers:\n${JSON.stringify(redactedReqHeaders, null, 2)}\n` +
        `Request Body: ${printedReqBody}\n` +
        `---------------------------\n` +
        `Response Status: ${response.status}\n` +
        `Response Headers:\n${JSON.stringify(redactedResHeaders, null, 2)}\n` +
        `Response Body: ${printedResBody}\n` +
        `===========================\n`
      );
    } catch (e: any) {
      // Fail silently to prevent crashing proxy flow on log print errors
    }

    return {
      statusCode: response.status,
      headers: resHeaders,
      body: responseBuffer,
      validationError
    };
  }

  /**
   * Simple path matcher supporting exact or basic parameter matching.
   */
  private matchPath(pattern: string, actual: string): boolean {
    const cleanPattern = pattern.split("?")[0].replace(/\/$/, "");
    const cleanActual = actual.split("?")[0].replace(/\/$/, "");
    if (cleanPattern === cleanActual) return true;

    // Convert e.g., /api/apps/:id to regex
    const regexStr = "^" + cleanPattern.replace(/:[a-zA-Z0-9_]+/g, "[^/]+") + "$";
    const regex = new RegExp(regexStr);
    return regex.test(cleanActual);
  }

  /**
   * Helper to perform basic JSON Schema validation (supporting properties, types, required arrays)
   */
  private validateJsonSchema(data: any, schema: any): string | null {
    if (!schema) return null;

    if (schema.type === "object") {
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        const actualType = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
        return `Expected object, got ${actualType}`;
      }

      if (schema.required && Array.isArray(schema.required)) {
        for (const reqProp of schema.required) {
          if (!(reqProp in data)) {
            return `Missing required property: ${reqProp}`;
          }
        }
      }

      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in data) {
            const err = this.validateJsonSchema(data[key], propSchema);
            if (err) return `${key}: ${err}`;
          }
        }
      }
    } else if (schema.type === "array") {
      if (!Array.isArray(data)) {
        return `Expected array, got ${typeof data}`;
      }
      if (schema.items) {
        for (let i = 0; i < data.length; i++) {
          const err = this.validateJsonSchema(data[i], schema.items);
          if (err) return `[${i}]: ${err}`;
        }
      }
    } else if (schema.type === "string") {
      if (typeof data !== "string") {
        return `Expected string, got ${typeof data}`;
      }
    } else if (schema.type === "number" || schema.type === "integer") {
      if (typeof data !== "number") {
        return `Expected number, got ${typeof data}`;
      }
    } else if (schema.type === "boolean") {
      if (typeof data !== "boolean") {
        return `Expected boolean, got ${typeof data}`;
      }
    }

    return null;
  }

  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const redacted: Record<string, string> = {};
    const sensitiveKeys = ["authorization", "cookie", "set-cookie", "x-api-key", "token", "session"];
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(s => lowerKey.includes(s))) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  private redactCookieString(cookieStr: string): string {
    if (!cookieStr) return "";
    return cookieStr
      .split(";")
      .map(part => {
        const trimmed = part.trim();
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) return trimmed;
        const name = trimmed.slice(0, eqIdx);
        return `${name}=[REDACTED]`;
      })
      .join("; ");
  }
}
