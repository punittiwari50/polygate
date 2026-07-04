import "@/register-paths.js";
import "reflect-metadata";
import readline from "readline";
import fs from "fs";
import path from "path";
import { Command } from "commander";
import { chromium } from "playwright";
import { version } from "@polygate/core";
import {
  PersistenceAdapterFactory,
  YamlPersistenceAdapter
} from "@polygate/persistence";
import { createGateway } from "@polygate/gateway-server";
import { PlaywrightRecorder } from "@/recorder/PlaywrightRecorder.js";
import { SeedToSqlConverter } from "@/recorder/SeedToSqlConverter.js";

export const cliVersion = version;
export const program = new Command();

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

program
  .name("polygate")
  .description("Unified Authenticated Application Gateway CLI")
  .version(cliVersion);

// 1. gateway:start
program
  .command("gateway:start")
  .description("Start the gateway Express server")
  .option("-p, --port <number>", "Port to run the gateway on", "8080")
  .option("-d, --driver <driver>", "Persistence driver (memory, yaml, oracle, redis)", "memory")
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const driver = options.driver;

    const persistence = await PersistenceAdapterFactory.create(driver);

    console.log(`Starting PolyGate server using ${driver} driver...`);
    const server = createGateway({ persistence, port });
    await server.start();
  });

// 2. seed:load
program
  .command("seed:load")
  .description("Load seed-data into the selected database backend")
  .option("-d, --driver <driver>", "Target persistence driver (memory, yaml, oracle, redis)", "memory")
  .action(async (options) => {
    const driver = options.driver;
    console.log(`Loading seed data into ${driver} driver...`);

    const yamlAdapter = new YamlPersistenceAdapter();
    // Golden Rule 2: async registry map — no if/else/switch
    const adapterRegistry: Record<string, () => Promise<any>> = {
      yaml: async () => yamlAdapter,
      oracle: () => PersistenceAdapterFactory.create("oracle"),
      redis: () => PersistenceAdapterFactory.create("redis"),
      memory: () => PersistenceAdapterFactory.create("memory")
    };
    const loader = adapterRegistry[driver.toLowerCase()] ?? adapterRegistry.memory;
    const targetAdapter = await loader();

    // Read apps from YAML seed dir
    const apps = await yamlAdapter.appRepository.list();
    for (const app of apps) {
      console.log(`Seeding application: ${app.displayName} (${app.appKey})`);
      const savedApp = await targetAdapter.appRepository.upsert(app);

      // Read endpoints for this app
      const appId = savedApp.id;
      const endpoints = appId ? await yamlAdapter.endpointRepository.list(appId) : [];
      for (const ep of endpoints) {
        console.log(`  Seeding endpoint: ${ep.name} -> ${ep.httpMethod} ${ep.path}`);
        await targetAdapter.endpointRepository.upsert({ ...ep, appId: savedApp.id! });
      }
    }

    console.log("Seed data loaded successfully.");
  });

// 3. login
program
  .command("login")
  .description("Render the login page in the browser and capture success session credentials")
  .requiredOption("-a, --app <key>", "Application key (e.g. kite)")
  .action(async (options) => {
    const appKey = options.app;
    
    // 1. Fetch Application config from gateway management API
    let app: any;
    try {
      const res = await fetch(`${GATEWAY_URL}/api/apps`);
      if (res.ok) {
        const apps = await res.json() as any[];
        app = apps.find(a => (a.appKey || a.key || "").toLowerCase() === appKey.toLowerCase());
      }
    } catch (err: any) {
      console.warn(`[WARN] Could not connect to gateway: ${err.message}`);
    }

    if (!app) {
      console.log(`Application "${appKey}" not found in gateway. Attempting to register from local seed data...`);
      try {
        const yamlAdapter = new YamlPersistenceAdapter();
        const localApp = await yamlAdapter.appRepository.findByKey(appKey);
        if (!localApp) {
          console.error(`Error: Application "${appKey}" is not configured in the gateway and no local seed file found.`);
          process.exit(1);
        }

        // Register with gateway
        const regRes = await fetch(`${GATEWAY_URL}/api/apps`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(localApp)
        });
        if (!regRes.ok) {
          const text = await regRes.text();
          throw new Error(`Failed to register app: ${text}`);
        }
        app = localApp;
        console.log(`Successfully auto-registered application "${appKey}" in the gateway.`);

        // Register any local endpoints
        try {
          const endpoints = await yamlAdapter.endpointRepository.list(localApp.id || 0);
          for (const ep of endpoints) {
            await fetch(`${GATEWAY_URL}/api/apps/${appKey}/endpoints`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(ep)
            });
          }
        } catch {
          // Ignore endpoint seed failures
        }
      } catch (err: any) {
        console.error(`Error: Application "${appKey}" is not configured in the gateway: ${err.message}`);
        process.exit(1);
      }
    }

    if (!app.loginUrl) {
      console.error(`Error: Application ${appKey} has no loginUrl configured.`);
      process.exit(1);
    }

    console.log(`Launching headful browser for login capture at ${app.loginUrl}...`);
    console.log("Please perform login in the browser window.");

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    let lastHeaders: Record<string, string> = {};
    page.on("response", async (response) => {
      const reqType = response.request().resourceType();
      if (reqType === "document" && response.status() === 200) {
        lastHeaders = {};
        try {
          const headers = await response.headersArray();
          headers.forEach((h: { name: string; value: string }) => {
            lastHeaders[h.name] = h.value;
          });
        } catch {
          // ignore failures on closed contexts
        }
      }
    });

    // Capture custom request headers (like x-kite-* and authorization) sent by browser
    page.on("request", (request) => {
      try {
        const headers = request.headers();
        for (const [key, value] of Object.entries(headers)) {
          const lowerKey = key.toLowerCase();
          if (
            lowerKey.startsWith("x-kite-") ||
            lowerKey === "authorization"
          ) {
            lastHeaders[key] = value;
          }
        }
      } catch {
        // ignore failures on closed contexts/frames
      }
    });

    await page.goto(app.loginUrl);

    const successPattern = app.loginSuccessUrlPattern || "dashboard|home|portfolio|account";
    const successCookie = app.loginSuccessCookieName || "kf_session|enctoken|session|sid|token";

    let success = false;
    // Poll for success signal
    for (let i = 0; i < 300; i++) {
      try {
        const currentUrl = page.url();
        const cookies = await context.cookies();

        const matchesUrl = successPattern ? new RegExp(successPattern, "i").test(currentUrl) : false;
        const matchesCookie = successCookie ? cookies.some(c => new RegExp(successCookie, "i").test(c.name)) : false;

        let isSuccess = false;
        if (successPattern && successCookie) {
          isSuccess = matchesUrl && matchesCookie;
        } else if (successPattern) {
          isSuccess = matchesUrl;
        } else if (successCookie) {
          isSuccess = matchesCookie;
        }

        if (isSuccess) {
          success = true;
          console.log("Success login signal detected!");
          break;
        }
      } catch (err) {
        // Break if the browser was closed or page became unavailable
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!success) {
      console.error("Login capture timed out or browser was closed before completion.");
      await browser.close();
      process.exit(1);
    }

    const finalCookies = await context.cookies();
    await browser.close();

    console.log(`Captured ${finalCookies.length} cookies and ${Object.keys(lastHeaders).length} navigation headers.`);

    // Send session to Gateway
    try {
      const sessionRes = await fetch(`${GATEWAY_URL}/api/apps/${appKey}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cookies: finalCookies,
          headers: lastHeaders
        })
      });

      if (sessionRes.ok) {
        console.log(`Session credentials saved successfully for ${appKey}.`);
      } else {
        const errBody = await sessionRes.text();
        console.error(`Failed to save session credentials: ${errBody}`);
      }
    } catch (err: any) {
      console.error(`Network error saving credentials: ${err.message}`);
    }
  });

// 4. verify
program
  .command("verify")
  .description("Execute a stored endpoint definition using the active session and print results")
  .requiredOption("-a, --app <key>", "Application key (e.g. kite)")
  .requiredOption("-e, --endpoint <name>", "Recorded endpoint name")
  .option("-s, --session <uuid>", "Target session UUID for multi-user verification")
  .action(async (options) => {
    const appKey = options.app;
    const epName = options.endpoint;
    const sessionUuid = options.session;

    console.log(`Verifying endpoint ${epName} for application ${appKey}...`);

    try {
      const headers: Record<string, string> = {};
      if (sessionUuid) {
        headers["x-polygate-session-uuid"] = sessionUuid;
      }

      const res = await fetch(`${GATEWAY_URL}/api/apps/${appKey}/verify/${epName}`, {
        method: "POST",
        headers
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Verification request failed: ${text}`);
        process.exit(1);
      }

      const result = await res.json() as any;
      console.log("--- Verification Results ---");
      console.log(`Status Code: ${result.statusCode}`);
      console.log("Headers:", JSON.stringify(result.headers, null, 2));
      console.log("Validation Error:", result.validationError || "None");
      console.log("Body Payload:");
      try {
        const parsed = JSON.parse(result.body);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(result.body);
      }
    } catch (err: any) {
      console.error(`Error executing verification: ${err.message}`);
    }
  });

// 4b. session:list
program
  .command("session:list")
  .description("List captured session metadata (UUIDs and user IDs) for an application")
  .requiredOption("-a, --app <key>", "Application key (e.g. kite)")
  .action(async (options) => {
    const appKey = options.app;

    console.log(`Fetching captured sessions for application ${appKey}...`);

    try {
      const res = await fetch(`${GATEWAY_URL}/api/apps/${appKey}/sessions`);

      if (!res.ok) {
        const text = await res.text();
        console.error(`Failed to list sessions: ${text}`);
        process.exit(1);
      }

      const sessions = await res.json() as any[];
      if (sessions.length === 0) {
        console.log("No captured sessions found.");
        return;
      }

      console.log("--- Captured Sessions ---");
      console.table(sessions.map(s => ({
        "User ID": s.userId || "N/A",
        "Session UUID": s.sessionUuid,
        "Captured At": s.capturedAt,
        "Active": s.isActive ? "Yes" : "No"
      })));
    } catch (err: any) {
      console.error(`Error listing sessions: ${err.message}`);
    }
  });

// 5. endpoint:add
program
  .command("endpoint:add")
  .description("Interactively or via flags record a new endpoint contract")
  .requiredOption("-a, --app <key>", "Application key")
  .option("-n, --name <name>", "Unique name of the endpoint")
  .option("-p, --path <path>", "Upstream route path")
  .option("-m, --method <method>", "HTTP Method (GET, POST, PUT, PATCH, DELETE)", "GET")
  .option("-r, --requiresAuth <boolean>", "Whether authentication is required", "true")
  .option("-d, --description <desc>", "Description of the endpoint")
  .action(async (options) => {
    const appKey = options.app;
    
    let name = options.name;
    let pathStr = options.path;
    let method = options.method;
    let requiresAuth = options.requiresAuth === "true";
    let description = options.description;

    if (!name) name = await askQuestion("Enter endpoint name (e.g. getHoldings): ");
    if (!pathStr) pathStr = await askQuestion("Enter path (e.g. /portfolio/holdings): ");
    if (!description) description = await askQuestion("Enter description: ");

    const endpointDef = {
      name,
      path: pathStr,
      httpMethod: method.toUpperCase(),
      requiresAuth,
      description
    };

    console.log(`Saving endpoint ${name} for ${appKey}...`);

    try {
      const res = await fetch(`${GATEWAY_URL}/api/apps/${appKey}/endpoints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(endpointDef)
      });

      if (res.ok) {
        console.log("Endpoint definition recorded successfully.");
      } else {
        const errText = await res.text();
        console.error(`Failed to save endpoint definition: ${errText}`);
      }
    } catch (err: any) {
      console.error(`Error saving endpoint definition: ${err.message}`);
    }
  });

// 6. record
program
  .command("record")
  .description("Launch a headful browser to record network APIs, GraphQL, WebSockets, and assets, generating YAML and SQL seeds")
  .requiredOption("-a, --app <key>", "Application key")
  .requiredOption("-u, --url <url>", "Initial URL to navigate to")
  .action(async (options) => {
    const appKey = options.app;
    const initialUrl = options.url;
    
    const recorder = new PlaywrightRecorder(appKey, initialUrl);
    await recorder.record();
  });

// 7. seed:sql
program
  .command("seed:sql")
  .description("Convert YAML seed data files into SQL DML scripts (Postgres, MySQL, Oracle)")
  .requiredOption("-a, --app <key>", "Application key")
  .option("-d, --dialect <dialect>", "Target dialect (postgres, mysql, oracle, or all)", "all")
  .action(async (options) => {
    const appKey = options.app;
    const dialect = options.dialect.toLowerCase();

    // Resolve seed directory
    let seedDir = path.join(process.cwd(), "seed-data");
    let current = process.cwd();
    while (true) {
      const hasWorkspace = fs.existsSync(path.join(current, "pnpm-workspace.yaml"));
      const hasRealSeed = fs.existsSync(path.join(current, "seed-data", "index.yaml"));
      if (hasWorkspace || hasRealSeed) {
        seedDir = path.join(current, "seed-data");
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    console.log(`Converting YAML seeds for application: ${appKey} to DML SQL...`);

    const dialects = dialect === "all" ? ["postgres", "mysql", "oracle"] : [dialect];
    for (const d of dialects) {
      try {
        const filePath = await SeedToSqlConverter.convertAndSave(appKey, d, seedDir);
        console.log(`Successfully generated and validated ${d} SQL script: ${filePath}`);
      } catch (err: any) {
        console.error(`Failed to convert for dialect ${d}: ${err.message}`);
      }
    }
  });

// Parse commands if run directly
if (require.main === module) {
  program.parse(process.argv);
}
