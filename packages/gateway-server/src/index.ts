import "reflect-metadata";
import express from "express";
import pino from "pino";
import { Server } from "http";
import { configureDI, version } from "@polygate/core";
import { AppController } from "@/controllers/AppController.js";
import { PersistenceAdapterFactory } from "@polygate/persistence";

export const serverVersion = version;

// Setup logger with secret redaction
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers.set-cookie",
      "cookie",
      "authorization",
      "set-cookie",
      "headers.cookie",
      "headers.authorization",
      "headers.Authorization"
    ],
    censor: "[REDACTED]"
  }
});

export class GatewayServer {
  private app: express.Express;
  private port: number;
  private server: Server | null = null;

  constructor(options: { persistence: any; port?: number }) {
    this.port = options.port || 8080;
    this.app = express();

    // 1. Bootstrap dependency injection
    configureDI({
      appRepository: options.persistence.appRepository,
      sessionRepository: options.persistence.sessionRepository,
      endpointRepository: options.persistence.endpointRepository,
      auditLogRepository: options.persistence.auditLogRepository
    });

    // 2. Setup middlewares
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logger middleware
    this.app.use((req, res, next) => {
      logger.info({ method: req.method, url: req.url }, "Incoming request");
      next();
    });

    // 3. Setup routes
    this.setupRoutes();
  }

  private setupRoutes() {
    // Alias route compatibility: GET /apps?key=:appKey
    this.app.all("/apps", (req, res, next) => {
      const appKey = req.query.key;
      if (typeof appKey === "string" && appKey) {
        (req.params as any).appKey = appKey;
        return AppController.proxyRequest(req, res);
      }
      next();
    });

    // Canonical routes
    this.app.all("/apps/:appKey", AppController.proxyRequest);
    this.app.all("/apps/:appKey/*", AppController.proxyRequest);

    // Management API routes
    this.app.get("/api/apps", AppController.listApps);
    this.app.post("/api/apps", AppController.upsertApp);
    this.app.get("/api/apps/:appKey/endpoints", AppController.listEndpoints);
    this.app.post("/api/apps/:appKey/endpoints", AppController.upsertEndpoint);
    this.app.post("/api/apps/:appKey/sessions", AppController.storeSession);
    this.app.get("/api/apps/:appKey/sessions", AppController.listSessions);
    this.app.delete("/api/apps/:appKey/sessions", AppController.logoutSession);
    this.app.post("/api/apps/:appKey/verify/:name", AppController.verifyEndpoint);
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`Gateway server v${serverVersion} listening on port ${this.port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) return reject(err);
          this.server = null;
          logger.info("Gateway server stopped");
          resolve();
        });
      });
    }
  }

  public getApp(): express.Express {
    return this.app;
  }
}

/**
 * Factory helper to create a GatewayServer instance.
 */
export function createGateway(options: { persistence: any; port?: number }): GatewayServer {
  return new GatewayServer(options);
}

// Direct run support (Golden Rule 2: factory registry — no if/else)
if (require.main === module) {
  const driver = process.env.PERSISTENCE_DRIVER || "memory";
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

  PersistenceAdapterFactory.create(driver)
    .then((adapter) => {
      const server = new GatewayServer({ persistence: adapter, port });
      return server.start();
    })
    .catch((err) => {
      logger.error(err, "Failed to start server");
    });
}
