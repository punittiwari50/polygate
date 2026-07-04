import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Application, EndpointDefinition } from "@polygate/core";
import { SqlGeneratorFactory } from "@/recorder/SqlGeneratorFactory.js";
import { WebsocketDefinition, AssetDefinition } from "@/recorder/SqlDialectGenerator.js";
import { Validator } from "@/recorder/Validator.js";

/**
 * Handles conversion of structured YAML configuration files into dialect-specific SQL DML scripts.
 */
export class SeedToSqlConverter {
  /**
   * Reads YAML seed data for an application and compiles it into a single SQL script.
   */
  public static convert(appKey: string, dialect: string, seedDir: string): string {
    const generator = SqlGeneratorFactory.getGenerator(dialect);
    const sqlStatements: string[] = [];

    sqlStatements.push(`-- PolyGate Seed DML generated for dialect: ${dialect}`);
    sqlStatements.push(generator.generateDdl());

    // 1. Convert Application
    const appYamlPath = path.join(seedDir, "apps", `${appKey}.yaml`);
    let appObj: Application | null = null;
    if (fs.existsSync(appYamlPath)) {
      try {
        const content = fs.readFileSync(appYamlPath, "utf8");
        const doc = yaml.load(content) as any;
        if (doc && doc.app) {
          appObj = {
            appKey: doc.app.key || doc.app.appKey || appKey,
            displayName: doc.app.displayName || appKey,
            baseUrl: doc.app.baseUrl,
            loginUrl: doc.app.loginUrl,
            authType: doc.app.authType || "NONE",
            status: doc.app.status || "ACTIVE",
            loginSuccessUrlPattern: doc.app.loginSuccessUrlPattern,
            loginSuccessCookieName: doc.app.loginSuccessCookieName,
            sessionInjectionRules: doc.app.sessionInjectionRules,
            userIdCookieName: doc.app.userIdCookieName
          };
          sqlStatements.push(generator.generateApplicationInsert(appObj));
          sqlStatements.push("");
        }
      } catch (err: any) {
        console.warn(`[WARN] Failed to parse Application YAML at ${appYamlPath}: ${err.message}`);
      }
    } else {
      console.warn(`[WARN] Application seed YAML not found: ${appYamlPath}`);
    }

    if (!appObj) {
      // Fallback app if app.yaml doesn't exist
      appObj = {
        appKey,
        displayName: `${appKey.toUpperCase()} Application`,
        baseUrl: "http://localhost",
        authType: "NONE",
        status: "ACTIVE"
      };
      sqlStatements.push(generator.generateApplicationInsert(appObj));
      sqlStatements.push("");
    }

    // 2. Convert Endpoints
    const endpointsDir = path.join(seedDir, "endpoints", appKey);
    if (fs.existsSync(endpointsDir)) {
      const files = fs.readdirSync(endpointsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        const epPath = path.join(endpointsDir, file);
        try {
          const content = fs.readFileSync(epPath, "utf8");
          const doc = yaml.load(content) as any;
          if (doc && doc.endpoint) {
            const ep: EndpointDefinition = {
              appId: 0,
              name: doc.endpoint.name,
              path: doc.endpoint.path,
              httpMethod: doc.endpoint.method || "GET",
              requiresAuth: doc.endpoint.requiresAuth ?? true,
              requestHeaders: doc.endpoint.requestHeaders,
              requestBodySchema: doc.endpoint.requestBody,
              responseBodySchema: doc.endpoint.responseBody,
              sampleResponse: doc.endpoint.sampleResponse,
              description: doc.endpoint.description
            };
            sqlStatements.push(generator.generateEndpointInsert(appKey, ep));
          }
        } catch (err: any) {
          console.warn(`[WARN] Failed to parse Endpoint YAML at ${epPath}: ${err.message}`);
        }
      }
      sqlStatements.push("");
    }

    // 3. Convert WebSockets
    const websocketsDir = path.join(seedDir, "websockets", appKey);
    if (fs.existsSync(websocketsDir)) {
      const files = fs.readdirSync(websocketsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        const wsPath = path.join(websocketsDir, file);
        try {
          const content = fs.readFileSync(wsPath, "utf8");
          const doc = yaml.load(content) as any;
          if (doc && doc.websocket) {
            const ws: WebsocketDefinition = doc.websocket;
            sqlStatements.push(generator.generateWebsocketInsert(appKey, ws));
          }
        } catch (err: any) {
          console.warn(`[WARN] Failed to parse WebSocket YAML at ${wsPath}: ${err.message}`);
        }
      }
      sqlStatements.push("");
    }

    // 4. Convert Assets
    const assetsDir = path.join(seedDir, "assets", appKey);
    if (fs.existsSync(assetsDir)) {
      const files = fs.readdirSync(assetsDir);
      for (const file of files) {
        const mimeType = this.guessMimeType(file);
        const asset: AssetDefinition = {
          appKey,
          name: `asset_${file.replace(/[^a-zA-Z0-9]/g, "_")}`,
          filePath: `assets/${appKey}/${file}`,
          mimeType
        };
        sqlStatements.push(generator.generateAssetInsert(appKey, asset));
      }
      sqlStatements.push("");
    }

    return sqlStatements.join("\n");
  }

  /**
   * Compiles the SQL statements and saves the script to seed-data/sql/.
   */
  public static async convertAndSave(appKey: string, dialect: string, seedDir: string): Promise<string> {
    const sqlContent = this.convert(appKey, dialect, seedDir);
    const projectRoot = path.dirname(seedDir);
    const sqlDir = path.join(projectRoot, "config", "db", dialect.toLowerCase());
    if (!fs.existsSync(sqlDir)) {
      fs.mkdirSync(sqlDir, { recursive: true });
    }

    const sqlFilePath = path.join(sqlDir, `${appKey.toLowerCase()}-dml.sql`);
    fs.writeFileSync(sqlFilePath, sqlContent, "utf8");

    // Perform validation check
    const validationResult = Validator.validateSql(sqlFilePath);
    if (!validationResult.isValid) {
      console.warn(`[VALIDATION WARN] Compiled SQL script has structural issues:`, validationResult.errors);
    }

    return sqlFilePath;
  }

  private static guessMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".svg") return "image/svg+xml";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".ico") return "image/x-icon";
    return "application/octet-stream";
  }
}
