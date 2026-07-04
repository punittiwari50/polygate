import { Request, Response } from "express";
import { container } from "@polygate/core";
import { AppService, SessionService, EndpointService, ProxyService } from "@polygate/core";
import { logger } from "@/index.js";

export class AppController {
  /**
   * Transparently proxies incoming HTTP request to upstream baseUrl of application.
   */
  public static async proxyRequest(req: Request, res: Response) {
    const { appKey } = req.params;
    if (!appKey) {
      return res.status(400).json({ error: "Missing appKey parameter" });
    }

    const fullPath = req.path;
    const prefix = `/apps/${appKey}`;
    const subPath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) || "/" : "/";

    try {
      const proxyService = container.resolve(ProxyService);
      const queryParams = { ...req.query };
      delete queryParams.key;

      const proxyRes = await proxyService.proxy(appKey, {
        method: req.method,
        path: subPath,
        queryParams: queryParams as Record<string, any>,
        headers: req.headers as Record<string, string>,
        body: req.body
      });

      // Log remote request connection details
      await AppController.logProxyCall(appKey, subPath, queryParams, req.method, proxyRes.statusCode);

      res.status(proxyRes.statusCode);
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        res.setHeader(key, value);
      }

      if (proxyRes.validationError) {
        res.setHeader("X-PolyGate-Validation-Error", proxyRes.validationError);
      }

      res.send(proxyRes.body);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /api/apps
   */
  public static async listApps(req: Request, res: Response) {
    try {
      const appService = container.resolve(AppService);
      const apps = await appService.listApps();
      res.json(apps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * POST /api/apps
   */
  public static async upsertApp(req: Request, res: Response) {
    try {
      const appService = container.resolve(AppService);
      const app = await appService.upsertApp(req.body);
      res.json(app);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  /**
   * GET /api/apps/:appKey/endpoints
   */
  public static async listEndpoints(req: Request, res: Response) {
    const { appKey } = req.params;
    try {
      const endpointService = container.resolve(EndpointService);
      const endpoints = await endpointService.listEndpoints(appKey);
      res.json(endpoints);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * POST /api/apps/:appKey/endpoints
   */
  public static async upsertEndpoint(req: Request, res: Response) {
    const { appKey } = req.params;
    try {
      const endpointService = container.resolve(EndpointService);
      const endpoint = await endpointService.upsertEndpoint(appKey, req.body);
      res.json(endpoint);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  /**
   * POST /api/apps/:appKey/sessions
   */
  public static async storeSession(req: Request, res: Response) {
    const { appKey } = req.params;
    const { cookies, headers, expiresAt } = req.body;
    if (!cookies || !headers) {
      return res.status(400).json({ error: "Missing cookies or headers in body" });
    }

    try {
      const sessionService = container.resolve(SessionService);
      await sessionService.saveSession(
        appKey,
        cookies,
        headers,
        expiresAt ? new Date(expiresAt) : undefined
      );
      res.json({ status: "success", message: "Session credentials stored successfully" });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  /**
   * DELETE /api/apps/:appKey/sessions
   */
  public static async logoutSession(req: Request, res: Response) {
    const { appKey } = req.params;
    try {
      const sessionService = container.resolve(SessionService);
      await sessionService.invalidateActiveSession(appKey);
      res.json({ status: "success", message: "Active session invalidated successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /api/apps/:appKey/sessions
   */
  public static async listSessions(req: Request, res: Response) {
    const { appKey } = req.params;
    try {
      const sessionService = container.resolve(SessionService);
      const sessions = await sessionService.listSessions(appKey);
      const safeSessions = sessions.map(s => ({
        id: s.id,
        appId: s.appId,
        capturedAt: s.capturedAt,
        expiresAt: s.expiresAt,
        userId: s.userId,
        sessionUuid: s.sessionUuid,
        isActive: s.isActive
      }));
      res.json(safeSessions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * POST /api/apps/:appKey/verify/:name
   */
  public static async verifyEndpoint(req: Request, res: Response) {
    const { appKey, name } = req.params;
    try {
      const endpointService = container.resolve(EndpointService);
      const matchedEndpoint = await endpointService.getEndpointByName(appKey, name);
      if (!matchedEndpoint) {
        return res.status(404).json({ error: `Endpoint ${name} not found for app ${appKey}` });
      }

      // Extract target session UUID if passed in verification headers
      const targetSessionUuid = req.headers["x-polygate-session-uuid"] || req.headers["x-polygate-session-uuid".toLowerCase()];

      const { body: customBody, headers: customHeaders } = req.body || {};

      // Execute request definition using proxy
      const proxyService = container.resolve(ProxyService);
      
      const mergedHeaders = {
        ...(matchedEndpoint.requestHeaders || {}),
        ...(customHeaders || {}),
        ...(targetSessionUuid ? { "x-polygate-session-uuid": String(targetSessionUuid) } : {})
      };

      const proxyRes = await proxyService.proxy(appKey, {
        method: matchedEndpoint.httpMethod || "GET",
        path: matchedEndpoint.path || "/",
        queryParams: {},
        headers: mergedHeaders,
        body: customBody !== undefined ? customBody : (matchedEndpoint.sampleResponse ? matchedEndpoint.sampleResponse : undefined)
      });

      // Log remote request connection details
      await AppController.logProxyCall(appKey, matchedEndpoint.path || "/", {}, matchedEndpoint.httpMethod || "GET", proxyRes.statusCode);

      res.json({
        statusCode: proxyRes.statusCode,
        headers: proxyRes.headers,
        body: proxyRes.body.toString("utf8"),
        validationError: proxyRes.validationError
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  private static async logProxyCall(appKey: string, subPath: string, queryParams: any, method: string, statusCode: number) {
    try {
      const appService = container.resolve(AppService);
      const app = await appService.getAppByKey(appKey);
      let targetUrl = "unknown";
      if (app) {
        let normalizedBaseUrl = app.baseUrl.trim();
        if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
          normalizedBaseUrl = `http://${normalizedBaseUrl}`;
        }
        const cleanBaseUrl = normalizedBaseUrl.replace(/\/$/, "");
        const cleanPath = subPath.startsWith("/") ? subPath : `/${subPath}`;
        targetUrl = `${cleanBaseUrl}${cleanPath}`;
        
        try {
          const urlObj = new URL(targetUrl);
          for (const [k, v] of Object.entries(queryParams || {})) {
            if (v !== undefined) {
              urlObj.searchParams.append(k, String(v));
            }
          }
          targetUrl = urlObj.toString();
        } catch {}
      }

      logger.info({
        appKey,
        targetUrl,
        method,
        statusCode
      }, "Proxy connection completed");
    } catch {}
  }
}
