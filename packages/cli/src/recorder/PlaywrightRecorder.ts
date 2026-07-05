import fs from "fs";
import path from "path";
import { chromium, Page, Response, WebSocket } from "playwright";
import yaml from "js-yaml";
import { Application, EndpointDefinition, matchesCaptureHeaders, DEFAULT_AUTH_TYPE, DEFAULT_APPLICATION_STATUS } from "@polygate/core";
import { SchemaGenerator } from "@/recorder/SchemaGenerator.js";
import { AssetDownloader } from "@/recorder/AssetDownloader.js";
import { SqlGeneratorFactory } from "@/recorder/SqlGeneratorFactory.js";
import { WebsocketDefinition, AssetDefinition } from "@/recorder/SqlDialectGenerator.js";
import { Validator } from "@/recorder/Validator.js";
import { SeedToSqlConverter } from "@/recorder/SeedToSqlConverter.js";

/**
 * Main orchestrator for Playwright-based traffic recording and code generation.
 */
export class PlaywrightRecorder {
  private appKey: string;
  private initialUrl: string;
  
  // Data stores for captured records
  private endpoints: Map<string, EndpointDefinition> = new Map();
  private websockets: Map<string, WebsocketDefinition> = new Map();
  private assets: Map<string, AssetDefinition> = new Map();

  constructor(appKey: string, initialUrl: string) {
    this.appKey = appKey.toLowerCase();
    this.initialUrl = initialUrl;
  }

  /**
   * Run the recording browser session and generate seed configurations.
   */
  public async record(): Promise<void> {
    console.log(`Starting headful browser session for app: ${this.appKey}`);
    console.log(`Initial URL: ${this.initialUrl}`);
    console.log("Interact with the website. Recording will finalize when you close the browser.");

    const headless = process.env.RECORDER_HEADLESS === "true";
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Hook request/response events
    page.on("response", (res) => this.handleResponse(res, page));
    page.on("websocket", (ws) => this.handleWebSocket(ws));

    try {
      await page.goto(this.initialUrl);
      
      const timeoutStr = process.env.RECORDER_TIMEOUT;
      if (timeoutStr) {
        const timeoutMs = parseInt(timeoutStr, 10);
        console.log(`Auto-closing browser in ${timeoutMs}ms...`);
        await new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await browser.close();
            } catch {}
            resolve();
          }, timeoutMs);
          page.on("close", () => resolve());
          browser.on("disconnected", () => resolve());
        });
      } else {
        // Wait until the page or browser is closed
        await new Promise<void>((resolve) => {
          page.on("close", () => resolve());
          browser.on("disconnected", () => resolve());
        });
      }
    } catch (err: any) {
      console.log(`Navigation or session ended: ${err.message}`);
    } finally {
      try {
        await browser.close();
      } catch {
        // Safe to ignore if already closed
      }
      
      await this.saveOutputs();
    }
  }

  /**
   * Captures REST and GraphQL endpoints, and identifies asset downloads.
   */
  private async handleResponse(response: Response, page: Page): Promise<void> {
    try {
      const request = response.request();
      const urlStr = response.url();
      const resourceType = request.resourceType();

      // Avoid capturing the gateway itself or localhost endpoints
      if (urlStr.includes("localhost:8080") || urlStr.includes("127.0.0.1:8080")) {
        return;
      }

      // Check if it is a static asset to download
      if (resourceType === "image" || this.isStaticAssetUrl(urlStr)) {
        await this.captureAsset(urlStr);
        return;
      }

      // Only capture API or document type requests for endpoints
      if (resourceType !== "fetch" && resourceType !== "xhr") {
        return;
      }

      const method = request.method().toUpperCase();
      const headers = request.headers();
      const status = response.status();

      // Only process successful requests to ensure correct schema extraction
      if (status !== 200) {
        return;
      }

      // Try reading bodies for JSON / GraphQL / general payloads
      let reqBodyJson: any = null;
      let resBodyJson: any = null;
      let isGraphQL = false;
      let queryName = "";

      const reqPostData = request.postData();
      if (reqPostData) {
        try {
          reqBodyJson = JSON.parse(reqPostData);
          if (reqBodyJson && (reqBodyJson.query || reqBodyJson.mutation)) {
            isGraphQL = true;
            queryName = reqBodyJson.operationName || this.extractGraphQLQueryName(reqBodyJson.query);
          }
        } catch {
          // not JSON or not parseable
        }
      }

      try {
        resBodyJson = await response.json();
      } catch {
        // Response is not JSON
      }

      const urlObj = new URL(urlStr);
      let endpointName = "";
      let endpointPath = urlObj.pathname;

      if (isGraphQL && queryName) {
        endpointName = `graphql_${queryName}`;
        endpointPath = `${urlObj.pathname}?graphql=${queryName}`;
      } else {
        endpointName = this.generateEndpointName(method, urlObj.pathname);
      }

      const reqBodySchema = reqBodyJson ? SchemaGenerator.infer(reqBodyJson) : undefined;
      const responseBodySchema = resBodyJson ? SchemaGenerator.infer(resBodyJson) : undefined;

      const appConfig = this.getExistingAppConfig();
      const capturePattern = appConfig?.sessionCaptureHeaders || "authorization,x-*";
      const filteredHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        const isCustomOrAuth = lowerKey.startsWith("x-") || lowerKey === "authorization";
        const matchesCapture = matchesCaptureHeaders(key, capturePattern);
        const headerValue = !isCustomOrAuth || matchesCapture
          ? "required"
          : undefined;

        if (headerValue !== undefined) {
          filteredHeaders[key] = headerValue;
        }
      }

      const ep: EndpointDefinition = {
        appId: 0, // placeholder updated during database insert or save
        name: endpointName,
        path: endpointPath,
        httpMethod: method as any,
        requiresAuth: true,
        requestHeaders: filteredHeaders,
        requestBodySchema: reqBodySchema,
        responseBodySchema,
        sampleResponse: resBodyJson,
        description: `Captured ${isGraphQL ? "GraphQL Query" : "API Endpoint"} for ${this.appKey}.`
      };

      this.endpoints.set(endpointName, ep);
    } catch {
      // Safe boundary: do not crash recording on single packet failure
    }
  }

  /**
   * Captures WebSockets URLs and headers.
   */
  private handleWebSocket(ws: WebSocket): void {
    try {
      const urlStr = ws.url();
      const urlObj = new URL(urlStr);
      const wsName = `ws_${urlObj.hostname.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
      
      const wsDef: WebsocketDefinition = {
        appKey: this.appKey,
        name: wsName,
        path: this.parameterizeWebSocketPath(urlObj),
        description: `Captured WebSocket connection to ${urlObj.hostname}`
      };

      this.websockets.set(wsName, wsDef);
    } catch {
      // Safe boundary
    }
  }

  private parameterizeWebSocketPath(urlObj: URL): string {
    const searchParams = new URLSearchParams(urlObj.search);
    const keys = Array.from(searchParams.keys());
    const sensitiveKeys = ["enctoken", "api_key", "token", "session", "user_id", "uid", "authorization", "cookie", "secret", "password", "key"];

    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        searchParams.set(key, `{${key}}`);
      }
    }

    const newSearch = searchParams.toString();
    return urlObj.protocol + "//" + urlObj.host + urlObj.pathname + (newSearch ? "?" + decodeURIComponent(newSearch) : "");
  }


  /**
   * Resiliently downloads and registers static assets.
   */
  private async captureAsset(urlStr: string): Promise<void> {
    try {
      const seedDir = this.getSeedDir();
      const assetsDir = path.join(seedDir, "assets", this.appKey);
      
      const downloadedFileName = await AssetDownloader.download(urlStr, assetsDir);
      if (downloadedFileName) {
        const mimeType = this.guessMimeType(downloadedFileName);
        const assetName = `asset_${downloadedFileName.replace(/[^a-zA-Z0-9]/g, "_")}`;
        
        const asset: AssetDefinition = {
          appKey: this.appKey,
          name: assetName,
          filePath: `assets/${this.appKey}/${downloadedFileName}`,
          mimeType
        };

        this.assets.set(assetName, asset);
      }
    } catch {
      // Safe boundary
    }
  }

  private getExistingAppConfig(): Application | null {
    try {
      const seedDir = this.getSeedDir();
      const appYamlPath = path.join(seedDir, "apps", `${this.appKey}.yaml`);
      if (fs.existsSync(appYamlPath)) {
        const content = fs.readFileSync(appYamlPath, "utf8");
        const doc = yaml.load(content) as any;
        if (doc && doc.app) {
          return {
            appKey: this.appKey,
            displayName: doc.app.displayName || this.appKey,
            baseUrl: doc.app.baseUrl,
            loginUrl: doc.app.loginUrl,
            authType: doc.app.authType || DEFAULT_AUTH_TYPE,
            status: doc.app.status || DEFAULT_APPLICATION_STATUS,
            loginSuccessUrlPattern: doc.app.loginSuccessUrlPattern,
            loginSuccessCookieName: doc.app.loginSuccessCookieName,
            sessionInjectionRules: doc.app.sessionInjectionRules,
            userIdCookieName: doc.app.userIdCookieName,
            sessionCaptureHeaders: doc.app.sessionCaptureHeaders
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Helper to write all captured configurations to files.
   */
  private async saveOutputs(): Promise<void> {
    const seedDir = this.getSeedDir();
    console.log(`\nFinalizing recording files under: ${seedDir}`);

    const existingApp = this.getExistingAppConfig();

    const appObj: Application = {
      appKey: this.appKey,
      displayName: existingApp?.displayName || `${this.appKey.toUpperCase()} Captured Application`,
      baseUrl: existingApp?.baseUrl || new URL(this.initialUrl).origin,
      loginUrl: existingApp?.loginUrl || this.initialUrl,
      authType: existingApp?.authType || DEFAULT_AUTH_TYPE,
      status: existingApp?.status || DEFAULT_APPLICATION_STATUS,
      loginSuccessUrlPattern: existingApp?.loginSuccessUrlPattern,
      loginSuccessCookieName: existingApp?.loginSuccessCookieName,
      sessionInjectionRules: existingApp?.sessionInjectionRules,
      userIdCookieName: existingApp?.userIdCookieName,
      sessionCaptureHeaders: existingApp?.sessionCaptureHeaders || "authorization,x-*"
    };

    // 1. Write Application YAML
    const appYamlPath = path.join(seedDir, "apps", `${this.appKey}.yaml`);
    fs.mkdirSync(path.dirname(appYamlPath), { recursive: true });
    fs.writeFileSync(appYamlPath, yaml.dump({ app: appObj }), "utf8");
    console.log(`Saved App configuration: ${appYamlPath}`);

    // Update index.yaml if missing
    this.registerInIndex(`apps/${this.appKey}.yaml`);

    // 2. Write Endpoints YAML
    const endpointsDir = path.join(seedDir, "endpoints", this.appKey);
    fs.mkdirSync(endpointsDir, { recursive: true });
    for (const [name, ep] of this.endpoints.entries()) {
      const epPath = path.join(endpointsDir, `${name}.yaml`);
      fs.writeFileSync(
        epPath,
        yaml.dump({
          endpoint: {
            app: this.appKey,
            name: ep.name,
            path: ep.path,
            method: ep.httpMethod,
            requiresAuth: ep.requiresAuth,
            requestHeaders: ep.requestHeaders,
            requestBody: ep.requestBodySchema,
            responseBody: ep.responseBodySchema,
            description: ep.description
          }
        }),
        "utf8"
      );
    }
    console.log(`Saved ${this.endpoints.size} Endpoint YAMLs to ${endpointsDir}`);

    // 3. Write WebSockets YAML
    const websocketsDir = path.join(seedDir, "websockets", this.appKey);
    fs.mkdirSync(websocketsDir, { recursive: true });
    for (const [name, ws] of this.websockets.entries()) {
      const wsPath = path.join(websocketsDir, `${name}.yaml`);
      fs.writeFileSync(wsPath, yaml.dump({ websocket: ws }), "utf8");
    }
    console.log(`Saved ${this.websockets.size} WebSocket YAMLs to ${websocketsDir}`);

    // 4. Generate SQL DML files for each supported dialect
    const dialects = SqlGeneratorFactory.getSupportedDialects();
    for (const dialect of dialects) {
      const sqlFilePath = await SeedToSqlConverter.convertAndSave(this.appKey, dialect, seedDir);
      console.log(`Saved SQL DML script (${dialect}): ${sqlFilePath}`);

      // 5. Run Validations on generated files
      this.validateGeneratedFiles(appYamlPath, sqlFilePath);
    }
  }

  private validateGeneratedFiles(yamlPath: string, sqlPath: string): void {
    // Validate YAML
    const yamlResult = Validator.validateYaml(yamlPath);
    if (!yamlResult.isValid) {
      console.error(`[VALIDATION WARN] YAML ${yamlPath} is structurally invalid:`, yamlResult.errors);
    } else {
      console.log(`[VALIDATION OK] YAML file is structurally valid: ${path.basename(yamlPath)}`);
    }

    // Validate SQL
    const sqlResult = Validator.validateSql(sqlPath);
    if (!sqlResult.isValid) {
      console.error(`[VALIDATION WARN] SQL ${sqlPath} failed basic structural validation:`, sqlResult.errors);
    } else {
      console.log(`[VALIDATION OK] SQL file passed basic structural checks: ${path.basename(sqlPath)}`);
    }
  }

  private registerInIndex(appPath: string): void {
    try {
      const indexFilePath = path.join(this.getSeedDir(), "index.yaml");
      let indexObj: any = { load: [] };

      if (fs.existsSync(indexFilePath)) {
        const content = fs.readFileSync(indexFilePath, "utf8");
        indexObj = yaml.load(content) || { load: [] };
      }

      if (!indexObj.load) {
        indexObj.load = [];
      }

      if (!indexObj.load.includes(appPath)) {
        indexObj.load.push(appPath);
        fs.writeFileSync(indexFilePath, yaml.dump(indexObj), "utf8");
      }
    } catch {
      // ignore resiliently
    }
  }

  private isStaticAssetUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes(".svg") ||
      lower.includes(".png") ||
      lower.includes(".jpg") ||
      lower.includes(".jpeg") ||
      lower.includes(".webp") ||
      lower.includes(".gif") ||
      lower.includes(".ico")
    );
  }

  private guessMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".svg") return "image/svg+xml";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".ico") return "image/x-icon";
    return "application/octet-stream";
  }

  private generateEndpointName(method: string, pathname: string): string {
    // Convert e.g. GET /portfolio/holdings to get_portfolio_holdings
    const cleanedPath = pathname
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/(^_|_$)/g, "");
    return `${method.toLowerCase()}_${cleanedPath || "root"}`;
  }

  private extractGraphQLQueryName(query: string): string {
    // Resiliently grab the query or mutation name
    // e.g. query FetchHoldings { ... } or mutation updateItem { ... }
    const match = query.match(/(query|mutation)\s+([a-zA-Z0-9_]+)/);
    return match ? match[2] : `query_${Date.now()}`;
  }

  private getSeedDir(): string {
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
  }
}
