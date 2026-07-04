# PolyGate

Unified Authenticated Application Gateway Platform.

## Prerequisites

- **Node.js**: `^20.0.0` or higher
- **pnpm**: `^11.0.0` (Recommended) or `npm`

---

## Installation & Windows EPERM Workaround

On Windows systems, `pnpm` might fail with an `EPERM: operation not permitted` error when trying to create symbolic links, especially if Windows **Developer Mode** is disabled. 

To resolve this, the project is pre-configured with a custom `pnpm-workspace.yaml` that:
1. Uses the flat hoisted linker (`nodeLinker: hoisted`) similar to `npm`.
2. Enables symbolic links (`symlink: true`) to resolve local workspace dependencies (automatically falling back to directory junctions on Windows when Developer Mode is disabled).
3. Uses local, git-ignored workspace directories for the pnpm store and cache (`storeDir: ./.pnpm-store` and `cacheDir: ./.pnpm-cache`).
4. Disables lockfile generation (`lockfile: false`) to avoid committing lock files.

### Step-by-Step Setup

1. **Install Dependencies**:
   ```bash
   pnpm install
   ```

   > [!NOTE]
   > Under pnpm v11, build scripts for packages like `oracledb` are blocked by default for security. The workspace is configured to approve the `oracledb` build script automatically.

2. **Verify Workspace Dependency Management**:
   To ensure all package dependencies are synchronized with the root manager:
   ```bash
   pnpm run sync-deps
   ```

---

## Build Commands

PolyGate is a TypeScript monorepo utilizing TypeScript Project References. Use the following commands to manage the build lifecycle:

### 1. Build the Entire Monorepo
To compile all workspace projects (`packages/core`, `packages/persistence`, `packages/gateway-server`, `packages/cli`):
```bash
pnpm run build
```

This compiles TypeScript files across all packages into their respective `dist` directories in topological order.

### 2. Clean Build Outputs
To clean all compiler outputs and caches:
```bash
pnpm run clean
```

### 3. Type Checking Only
To check TypeScript types without emitting files:
```bash
pnpm run typecheck
```

---

## Standalone & Integration Testing

### 1. Standalone Verification

You can test PolyGate's components directly within this repository.

#### Running the Test Suite
Once tests are added, you can run all unit, contract, and integration tests using:
```bash
pnpm run test
```

#### Running the Gateway Server Standalone
The gateway server acts as the primary HTTP entry point resolving and proxying downstream applications. To start it:
```bash
pnpm --filter @polygate/gateway-server start
```
This runs the Express application, which defaults to listening on `http://localhost:8080`.

#### Running the CLI
The CLI drives operator commands (e.g. GitHub login session capture via Playwright, seed loading, and starting the gateway). To run commands:
```bash
pnpm --filter @polygate/cli run dev <command> [options]
```
For example, to run `gateway:start` via CLI:
```bash
pnpm --filter @polygate/cli run dev gateway:start
```

---

### 2. Testing Zerodha (Kite) Application

To verify and test the Zerodha Kite (`kite`) application integration locally:

#### Step 1: Start the Gateway Server
The gateway server needs to run with the YAML persistence adapter to load the application configuration and endpoint seeds (like `seed-data/apps/kite.yaml` and `seed-data/endpoints/kite/*.yaml`):
```bash
# Using CLI to start server with the yaml driver
pnpm --filter @polygate/cli run dev gateway:start --driver yaml
```

> [!IMPORTANT]
> **Persistence Driver Dependency**: The gateway must be started with the `--driver yaml` option (or have its database pre-populated using `pnpm --filter @polygate/cli run dev seed:load --driver <driver>`) before you can run the login capture. Starting the gateway without `--driver yaml` will default to the transient `memory` driver which starts completely empty, leading to the error `Application <appKey> is not configured in the gateway.` when attempting to capture login credentials.


#### Step 2: Run the Login Flow
Open a new terminal window/tab and run the Playwright-driven login capture for `kite`:
```bash
pnpm --filter @polygate/cli run dev login -a kite
```
This command will launch a headful browser page navigating to `https://kite.zerodha.com`. Perform your login manually. Once the browser detects the dashboard URL (`kite.zerodha.com/dashboard`) or the `kf_session` cookie, the login details (cookies and headers) will be securely captured and transmitted to the running gateway server.

#### Step 3: Verify the Endpoints
Once authenticated, you can query and test specific Zerodha endpoints using the active session credentials:
```bash
# Verify the getMargins endpoint
pnpm --filter @polygate/cli run dev verify -a kite -e getMargins

# Verify the getHoldings endpoint
pnpm --filter @polygate/cli run dev verify -a kite -e getHoldings

# Verify the getHoldings endpoint targeting a specific session UUID
pnpm --filter @polygate/cli run dev verify -a kite -e getHoldings -s <sessionUuid>
```

#### Step 4: List Stored Sessions (Tabular Format)
To view all captured session metadata (UUIDs, user IDs, capture times, and active status) for an application in a tabular format, run:
```bash
pnpm --filter @polygate/cli run dev session:list -a kite
```

---

### 3. Interactive Network Traffic Recorder & Generator (Playwright)

PolyGate includes a robust, Playwright-driven traffic recorder that intercepts browser sessions to dynamically capture and generate seed data.

#### Running the Recorder
To start a recording session for a new or existing application:
```bash
pnpm --filter @polygate/cli run dev record -a <appKey> -u <initialUrl>
```
For example, to capture network endpoints and assets for Zerodha Kite:
```bash
pnpm --filter @polygate/cli run dev record -a kite -u https://kite.zerodha.com
```

#### What is Generated?
When you interact with the headful browser window and close it, the recorder automatically generates and validates several assets under `seed-data/`:
1. **Application Spec**: Saves configuration to `seed-data/apps/<appKey>.yaml`.
2. **Endpoint Specs**: Analyzes all API and **GraphQL** requests, infers request/response **JSON schemas** programmatically, and saves them to `seed-data/endpoints/<appKey>/<method_path>.yaml`.
3. **WebSockets Spec**: Captures active WebSockets URLs and handshakes, saving them to `seed-data/websockets/<appKey>/<ws_name>.yaml`.
4. **Downloaded Assets**: Resiliently downloads all static assets (SVGs, PNGs, JPEGs, Favicons) into `seed-data/assets/<appKey>/`.
5. **SQL DML Scripts**: Automatically transforms all generated seed definitions into SQL `INSERT` (upsert/merge) scripts for **PostgreSQL**, **MySQL**, and **Oracle DB**, writing them to [config/db/](file:///c:/DEV/PROJECTS/ML_BASICS/polygate/config/db/) directory, i.e., `config/db/<dialect>/<appKey>-dml.sql`.

All outputs are dynamically validated for structural syntax (YAML & SQL formatting) at the end of the recording.

---

### 4. Configuring Persistence Adapters

PolyGate supports three interchangeable persistence drivers (adapters) that implement repository ports for applications, sessions, endpoints, and audit logs.

#### Storage & Git Security (YAML)
*   When using the **YAML adapter**, your active login session tokens, headers, and cookies are saved to [seed-data/sessions.json](file:///c:/DEV/PROJECTS/ML_BASICS/polygate/seed-data/sessions.json).
*   **Security Protection**: This file is explicitly ignored in [.gitignore](file:///c:/DEV/PROJECTS/ML_BASICS/polygate/.gitignore) to guarantee credentials are never checked into Git.

#### Driver Configurations

##### Option A: YAML Files Adapter (Default for development)
*   **Active Sessions**: Saved to git-ignored `seed-data/sessions.json`.
*   **How to Run (CLI)**:
    ```bash
    pnpm --filter @polygate/cli run dev gateway:start --driver yaml
    ```
*   **How to Configure (Library)**:
    ```typescript
    import { configureDI } from "@polygate/core";
    import { YamlPersistenceAdapter } from "@polygate/persistence";

    const persistence = new YamlPersistenceAdapter();
    configureDI({
      appRepository: persistence.appRepository,
      sessionRepository: persistence.sessionRepository,
      endpointRepository: persistence.endpointRepository,
      auditLogRepository: persistence.auditLogRepository
    });
    ```

##### Option B: In-Memory Adapter
*   **Storage Location**: Volatile in-memory maps (resets when gateway process exits). Ideal for CI.
*   **How to Run (CLI)**:
    ```bash
    pnpm --filter @polygate/cli run dev gateway:start --driver memory
    ```
*   **How to Configure (Library)**:
    ```typescript
    import { configureDI } from "@polygate/core";
    import { MemoryPersistenceAdapter } from "@polygate/persistence";

    const persistence = new MemoryPersistenceAdapter();
    configureDI({
      appRepository: persistence.appRepository,
      sessionRepository: persistence.sessionRepository,
      endpointRepository: persistence.endpointRepository,
      auditLogRepository: persistence.auditLogRepository
    });
    ```

##### Option C: Relational Database (Oracle / RDBMS)
*   **Storage Location**: Persistent relational tables.
*   **How to Run (CLI)**:
    ```bash
    pnpm --filter @polygate/cli run dev gateway:start --driver oracle
    ```
*   **How to Configure (Library)**:
    ```typescript
    import { configureDI } from "@polygate/core";
    import { OraclePersistenceAdapter } from "@polygate/persistence";

    const persistence = new OraclePersistenceAdapter();
    configureDI({
      appRepository: persistence.appRepository,
      sessionRepository: persistence.sessionRepository,
      endpointRepository: persistence.endpointRepository,
      auditLogRepository: persistence.auditLogRepository
    });
    ```

#### Viewing Configured Details & Active Sessions

##### 1. Inspecting Data via Gateway Management API
The running gateway server exposes standard HTTP endpoints to inspect active credentials and endpoints:
*   **List all applications**:
    ```bash
    curl http://localhost:8080/api/apps
    ```
*   **List endpoints for an application (e.g. `kite`)**:
    ```bash
    curl http://localhost:8080/api/apps/kite/endpoints
    ```
*   **View active session details**:
    For the YAML adapter, open the git-ignored `seed-data/sessions.json` directly:
    ```json
    [
      {
        "id": 1,
        "appId": 1,
        "isActive": true,
        "cookies": {
          "kf_session": "xyz123abc"
        },
        "headers": {
          "Authorization": "token abc-123"
        },
        "capturedAt": "2026-06-29T20:00:00.000Z"
      }
    ]
    ```

##### 2. Querying RDBMS Database Tables
If utilizing the relational adapter, you can view saved configurations and sessions directly via SQL:
```sql
-- View all registered gateway applications with customer channel base URL
SELECT a.APP_ID, a.APP_KEY, a.DISPLAY_NAME, c.BASE_URL 
FROM PG_APPLICATION a
LEFT JOIN PG_APP_ACCESS_CHANNEL c ON a.APP_ID = c.APP_ID AND c.CHANNEL_TYPE = 'CUSTOMER';

-- View captured session credentials for an application key 'kite'
SELECT s.SESSION_ID, s.COOKIE_PAYLOAD, s.HEADER_PAYLOAD, s.IS_ACTIVE 
FROM PG_SESSION_CREDENTIAL s
JOIN PG_USER_IDENTITY i ON s.IDENTITY_ID = i.IDENTITY_ID
JOIN PG_APPLICATION a ON i.APP_ID = a.APP_ID
WHERE a.APP_KEY = 'kite';
```

---

### 5. Integration with Other Projects

To use and test the `@polygate/core` library or the database adapter (`@polygate/persistence`) in separate client projects, you can integrate them locally without publishing to a remote package registry.

#### Option A: Package Linking (Recommended for active development)
1. **Link the package globally**:
   Navigate to the core library directory and link it:
   ```bash
   cd packages/core
   pnpm link --global
   ```
2. **Consume in target project**:
   In your other project's root folder, link the package:
   ```bash
   pnpm link --global @polygate/core
   ```

#### Option B: Project-Relative File Dependency
You can reference the local package directly in the `package.json` of your other project using absolute or relative paths:
```json
"dependencies": {
  "@polygate/core": "file:../path/to/polygate/packages/core"
}
```
Then run `pnpm install` (or `npm install`) in your target project.

#### Option C: Packing as a Tarball
1. **Generate the tarball**:
   Navigate to `packages/core` and generate a package archive:
   ```bash
   cd packages/core
   pnpm pack
   ```
   This generates a package file (e.g., `polygate-core-1.0.0.tgz`).
2. **Install the tarball**:
   In your other project, install it directly:
   ```bash
   pnpm install /path/to/polygate-core-1.0.0.tgz
   ```

#### Programmatic Library Usage (TypeScript / JavaScript)

Once the library is linked or installed in your target project, you can initialize the Dependency Injection (DI) system and resolve services programmatically:

1. **Initialize the DI System**:
   Import `configureDI` and pass the repository adapters of your choice (e.g., from `@polygate/persistence`):
   ```typescript
   import { configureDI } from "@polygate/core";
   import { MemoryPersistenceAdapter } from "@polygate/persistence"; // or YamlPersistenceAdapter, OraclePersistenceAdapter

   const persistence = new MemoryPersistenceAdapter();

   configureDI({
     appRepository: persistence.appRepository,
     sessionRepository: persistence.sessionRepository,
     endpointRepository: persistence.endpointRepository,
     auditLogRepository: persistence.auditLogRepository
   });
   ```

2. **Resolve and Use Services**:
   Use the exported `container` (from `tsyringe`) to resolve and invoke service methods:
   ```typescript
   import { container, AppService, ProxyService } from "@polygate/core";

   // Resolve singleton service instances
   const appService = container.resolve(AppService);
   const proxyService = container.resolve(ProxyService);

   // Use the services
   const apps = await appService.listApps();
   console.log("Configured apps:", apps);
   ```

---

## Troubleshooting

### Terminating Locked Node.js / NPM / PNPM Processes (Windows)

If a server process gets locked in the background or fails to release a port (like `8080`), you can force-kill all instances of Node, NPM, and PNPM via CLI. These commands target processes owned by your current user session, so they do not require administrator privileges or passwords.

#### In Command Prompt (CMD)
```cmd
taskkill /F /IM node.exe
taskkill /F /IM npm.exe
taskkill /F /IM pnpm.exe
```

#### In PowerShell
```powershell
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "npm" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "pnpm" -Force -ErrorAction SilentlyContinue
```