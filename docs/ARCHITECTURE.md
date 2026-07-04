# PolyGate — Architecture & Project Specification

**Status:** Approved for build · **Owner:** Platform Engineering · **Spec version:** 1.0

This document is the single source of truth for the project. `GEMINI.md` and
`.github/copilot-instructions.md` are deliberately short and both point back here —
do not duplicate this content into those files; extend this document instead and let
them keep linking to it.

---

## 1. Project Identity

### 1.1 Name

**PolyGate** — *Unified, Authenticated Application Gateway & CLI Toolkit*

**Why this name:** the project is, at its core, a gateway that sits in front of
**many** (`poly-`) downstream applications, supports **many** interchangeable
database backends (in-memory / YAML / Oracle), and is explicitly designed to be
re-implemented in **multiple** languages (Node/TypeScript first, Python or pure
Java later) without those implementations depending on each other.

Alternate names considered, in case a different one is preferred: `SessionForge`,
`NexusGate`. Unless told otherwise, all generated code, package names, CLI binary
name (`polygate`), and documentation use **PolyGate**.

### 1.2 One-paragraph summary

PolyGate is a self-hosted gateway plus a CLI and library. The gateway resolves a
short **app key** (e.g. `copilot`) to a real upstream URL and proxies/renders it.
The CLI drives a real browser to a login page (e.g. GitHub's), waits for the
operator to complete login, captures the resulting cookies and headers, and
persists them. Everything the gateway needs to know about an app — its base URL,
auth type, and the HTTP endpoints it exposes (method, headers, request/response
shape) — is modeled as a small relational schema that can be backed by memory,
YAML files, or an Oracle database, selected purely by configuration.

---

## 2. Requirement Traceability Matrix

Every numbered requirement from the original project brief is resolved here so
that no design decision needs to be re-litigated mid-build.

| # | Original requirement (paraphrased) | Resolution |
|---|---|---|
| 1 | Professional project name | **PolyGate** — see §1.1 |
| 2 | Gateway answering `http://localhost:8080/apps=copilot` | The literal string `/apps=copilot` is not a valid REST path. Canonical contract is `GET /apps/:appKey` (e.g. `/apps/copilot`); a query-string alias `GET /apps?key=copilot` is also supported for compatibility. See §6. |
| 3 | CLI must render the GitHub login page | `polygate login --app <key>` launches a real, visible browser session (Playwright) navigating to the app's configured `loginUrl`. See §7.2. |
| 4 | On login success, fetch cookies/headers and save to DB | The CLI detects a successful-login signal (configurable: URL change, DOM element, or cookie presence), extracts the cookie jar + response headers from the browser context, encrypts them, and persists via `ISessionRepository`. See §7.2, §10. |
| 5 | RDBMS structure supporting in-memory / YAML / Oracle, storing app→URL mapping for behind-the-scenes rendering | One relational schema (`config/db/postgres/database-schema.sql`), three adapters implementing the same repository interfaces. See §5. |
| 6 | Node/TS or Python or pure Java, no cross-stack dependency | Initial implementation: Node.js + TypeScript only. Architecture and contracts (schema, YAML format, REST contract, CLI surface) are written language-agnostically precisely so a future Python or Java port is a clean re-implementation, never a wrapper around this Node process. See §14. |
| 7 | CLI + library, CLI can verify other pages/endpoints | `packages/cli` is a thin executable over `packages/core`; every package is independently importable as a library. `polygate verify` exercises any stored endpoint definition and reports the live result. See §7, §8. |
| 8 | CLI saves endpoints with method/headers/body/response, produces well-organized YAML seed data | `polygate endpoint:add` records the definition and writes/updates `seed-data/endpoints/<appKey>/<endpointName>.yaml`. See §5.3. |
| 9 | Library just initializes/uses the data | `packages/core` + a chosen persistence adapter is all a consumer needs to `import` and run the gateway or query stored mappings — no CLI required at runtime. See §8. |
| 10 | Enterprise coding standards, OOP, SOLID, loose coupling, extensibility | Layered architecture, DI, interface-driven ports. See §9. |
| 11 | Spec to be handed to Gemini CLI / Copilot to build the Node project | This document + `GEMINI.md` + `.github/copilot-instructions.md`. |

---

## 3. System Architecture

```
                         ┌────────────────────────────┐
                         │         polygate (CLI)       │
                         │  login · verify · endpoint:add│
                         │  seed:load · gateway:start    │
                         └──────────────┬─────────────┘
                                        │ uses
                                        ▼
┌────────────────────────────────────────────────────────────────┐
│                         packages/core (Library)                 │
│  Entities: Application, SessionCredential, EndpointDefinition    │
│  Services: AppService, SessionService, EndpointService, ProxyService│
│  Ports (interfaces): IAppRepository, ISessionRepository,          │
│                       IEndpointRepository                        │
└───────────────────────────┬──────────────────────────────────────┘
                            │ implemented by (Dependency Inversion)
                            ▼
                ┌───────────────────────┐
                │  packages/persistence │
                │ memory · yaml · oracle│
                └───────────┬───────────┘
                            │
                            ▼
                  ┌────────────────────────┐
                  │   gateway-server         │
                  │  GET /apps/:appKey       │  → reverse-proxy/render
                  │  GET /apps?key=appKey    │     using stored session +
                  │  (management API, §6.3)  │     endpoint definitions
                  └────────────────────────┘
```

**Key property:** `packages/core` never imports a persistence package or a
framework. It only depends on the interfaces it declares. Adapters and the
gateway/CLI depend on `core` — never the reverse. This is the Dependency
Inversion Principle applied at the package boundary.

---

## 4. Repository / Package Layout

```
polygate/
├── GEMINI.md
├── .github/
│   └── copilot-instructions.md
├── docs/
│   └── ARCHITECTURE.md
├── config/
│   └── db/
│       └── postgres/
│           └── database-schema.sql
├── seed-data/
│   ├── index.yaml                     # registers which app files to load
│   ├── apps/
│   │   ├── copilot.yaml
│   │   └── <appKey>.yaml
│   └── endpoints/
│       ├── copilot/
│       │   ├── get-suggestion.yaml
│       │   └── <endpointName>.yaml
│       └── <appKey>/...
├── packages/
│   ├── core/                          # framework-free domain + services + ports
│   │   └── src/{entities,services,ports}/
│   ├── persistence/                   # unified storage adapters (memory, yaml, oracle)
│   ├── gateway-server/                # Express/Fastify app
│   └── cli/                           # oclif/commander entry point + Playwright flows
├── package.json                       # npm workspaces root
├── tsconfig.base.json
└── .eslintrc.cjs
```

Monorepo managed with **npm workspaces** (or pnpm, if preferred later) so each
package is independently versioned and independently testable, which is also
what makes a future single-language port straightforward to scope.

---

## 5. Domain Model & Persistence

### 5.1 Entities

- **Application** — one row per app key. `appKey` (unique, e.g. `copilot`),
  `displayName`, `baseUrl`, `loginUrl`, `authType`
  (`OAUTH_GITHUB | BASIC | API_KEY | NONE`), `status`.
- **SessionCredential** — one or more captured sessions per Application.
  Encrypted `cookiePayload`, encrypted `headerPayload`, `capturedAt`,
  `expiresAt`, `isActive`.
- **EndpointDefinition** — one row per recorded endpoint of an Application.
  `name`, `path`, `httpMethod`, `requiresAuth`, `requestHeaders` (JSON),
  `requestBodySchema` (JSON Schema), `responseBodySchema` (JSON Schema),
  `sampleResponse` (JSON), `description`.
- **AuditLog** *(optional, recommended)* — records `LOGIN`, `VERIFY`, `PROXY`,
  `SEED` actions with status code and timestamp, for traceability.

Full DDL: `config/db/postgres/database-schema.sql`. It is written against Oracle but uses
only portable constructs (identity columns, `CHECK` constraints, `CLOB` for
JSON payloads) so the same shape maps cleanly onto the in-memory and YAML
adapters.

### 5.2 Repository Interfaces (Ports)

```ts
// packages/core/src/ports/IAppRepository.ts
export interface IAppRepository {
  findByKey(appKey: string): Promise<Application | null>;
  list(): Promise<Application[]>;
  upsert(app: Application): Promise<Application>;
}

// packages/core/src/ports/ISessionRepository.ts
export interface ISessionRepository {
  saveSession(appId: string, session: SessionCredential): Promise<void>;
  getActiveSession(appId: string): Promise<SessionCredential | null>;
  invalidate(sessionId: string): Promise<void>;
}

// packages/core/src/ports/IEndpointRepository.ts
export interface IEndpointRepository {
  list(appId: string): Promise<EndpointDefinition[]>;
  findByName(appId: string, name: string): Promise<EndpointDefinition | null>;
  upsert(def: EndpointDefinition): Promise<EndpointDefinition>;
}
```

Each persistence package exports a class implementing all three interfaces
(e.g. `YamlAppRepository implements IAppRepository`). The active backend is
chosen once, at process start, via `PERSISTENCE_DRIVER=memory|yaml|oracle`,
and wired through the DI container — application code never imports a
concrete adapter directly.

### 5.3 YAML Seed-Data Convention

One file per app under `seed-data/apps/`, one file per endpoint under
`seed-data/endpoints/<appKey>/`. This is what `polygate endpoint:add` writes
to, and what the YAML persistence adapter (and the `seed:load` command for
the other backends) reads from.

```yaml
# seed-data/apps/copilot.yaml
app:
  key: copilot
  displayName: GitHub Copilot
  baseUrl: https://github.com/copilot
  loginUrl: https://github.com/login
  authType: OAUTH_GITHUB
  status: ACTIVE
```

```yaml
# seed-data/endpoints/copilot/get-suggestion.yaml
endpoint:
  app: copilot
  name: getSuggestion
  path: /copilot/api/suggestion
  method: POST
  requiresAuth: true
  requestHeaders:
    - name: Authorization
      required: true
    - name: Content-Type
      value: application/json
  requestBody:
    type: object
    properties:
      prompt: { type: string }
    required: [prompt]
  responseBody:
    type: object
    properties:
      suggestion: { type: string }
  description: Returns a code suggestion for the given prompt.
```

`seed-data/index.yaml` simply lists which app files to load on boot, so
environments can ship a subset:

```yaml
load:
  - apps/copilot.yaml
```

---

## 6. Gateway Routing Specification

### 6.1 Canonical route

```
GET /apps/:appKey
```

Resolves `appKey` → `Application` → active `SessionCredential` → performs a
server-side request to `Application.baseUrl` (plus any sub-path forwarded
after the key), injecting the stored cookies/headers, and streams the
upstream response back to the caller — i.e. the gateway renders the app
"behind the scenes" rather than redirecting the browser to it.

### 6.2 Alias (compatibility with the literal form in the brief)

```
GET /apps?key=:appKey
```

Routed to the exact same controller as §6.1. No second implementation.

### 6.3 Management API (for the CLI and for operators)

```
GET    /api/apps                       list configured apps
POST   /api/apps                       create/update an app mapping
GET    /api/apps/:appKey/endpoints     list recorded endpoints
POST   /api/apps/:appKey/endpoints     record a new endpoint definition
POST   /api/apps/:appKey/sessions      store a captured session (used by the CLI after login)
POST   /api/apps/:appKey/verify/:name  execute a stored endpoint and return the live result
```

These are the routes the CLI calls into — the CLI never touches a database
adapter directly, only the gateway's management API or, in library mode, the
`packages/core` services in-process.

---

## 7. CLI Specification

### 7.1 Commands

| Command | Purpose |
|---|---|
| `polygate login --app <key>` | Render the app's login page in a real browser and capture the resulting session on success. |
| `polygate verify --app <key> --endpoint <name>` | Execute a stored endpoint definition using the active session and print method/headers/body/status/response. |
| `polygate endpoint:add --app <key>` | Interactively (or via flags) record an endpoint's method, headers, request body, and response body, and persist it + write the YAML seed file. |
| `polygate seed:load [--driver memory\|yaml\|oracle]` | Load `seed-data/` into the selected backend. |
| `polygate gateway:start [--port 8080]` | Boot the gateway server (library entry point — see §8). |

### 7.2 GitHub Login Capture Flow

1. CLI resolves `Application.loginUrl` for the given `--app`.
2. Launches a Playwright **headful** Chromium context and navigates to it —
   this satisfies "render the GitHub login page."
3. Operator completes username/password and any 2FA in the real browser
   window.
4. CLI polls for a success signal (configurable per app: a URL pattern, a DOM
   selector, or the appearance of a specific cookie name) — never assumes
   success from a fixed timeout.
5. On success, CLI reads `context.cookies()` and the headers of the last
   navigation response, encrypts both, and calls
   `POST /api/apps/:appKey/sessions` (or `ISessionRepository.saveSession`
   directly in library mode).
6. Browser context is closed. Raw cookies/headers are never written to disk
   or stdout unencrypted.

### 7.3 Endpoint Recording Flow

`polygate endpoint:add` either prompts interactively or accepts flags for
method, path, headers, request body schema, and response body schema; it
validates the shapes with Zod, persists via `IEndpointRepository`, and writes
the corresponding file under `seed-data/endpoints/<appKey>/` in the format
shown in §5.3.

---

## 8. Library (SDK) Usage

A consumer who only wants the gateway, without ever using the CLI, does:

```ts
import { createGateway } from "@polygate/gateway-server";
import { YamlPersistenceAdapter } from "@polygate/persistence";

const gateway = createGateway({
  persistence: new YamlPersistenceAdapter({ seedDir: "./seed-data" }),
  port: 8080,
});

await gateway.start();
```

The library does no interactive capture and no recording — it only
initializes from whatever the chosen persistence adapter already has
(per requirement 9), then serves §6.

---

## 9. Coding Standards, OOP & SOLID Mapping

- **SRP** — `AppService`, `SessionService`, `EndpointService`, `ProxyService`
  each own exactly one responsibility; controllers only translate HTTP ⇄
  service calls.
- **OCP** — adding Postgres later means writing
  `PostgresAppRepository implements IAppRepository`; zero changes inside
  `packages/core`.
- **LSP** — any concrete repository is substitutable anywhere its interface
  is required; this is enforced by a shared contract test suite run against
  all three adapters.
- **ISP** — three narrow repository interfaces instead of one large
  `IRepository`, so a consumer that only needs app lookups never has to
  implement session or endpoint methods.
- **DIP** — services receive their repository via constructor injection
  (a lightweight container such as `tsyringe`); the composition root (CLI
  entry / gateway bootstrap) is the only place that knows which concrete
  adapter is in use.

**Conventions:** TypeScript strict mode; path aliases starting with `@/` instead of relative paths like `../` or `../../`; `camelCase` for variables/functions;
`PascalCase` for classes/interfaces; interfaces prefixed with `I`
(`IAppRepository`); ESLint (`@typescript-eslint/recommended`) + Prettier;
TSDoc on every exported symbol; Conventional Commits.

---

## 10. Security Considerations

- Cookies and headers are **secrets**: encrypt with AES-256-GCM before
  persisting (key from `SESSION_ENCRYPTION_KEY` env var, never hard-coded),
  decrypt only in-memory when proxying or verifying.
- Structured logger (pino) configured with a redaction list covering
  `cookie`, `authorization`, `set-cookie`.
- Seed YAML files committed to git must never contain real captured
  sessions — only app/endpoint *definitions*. `SessionCredential` is runtime
  data, not seed data, and is excluded via `.gitignore` when the YAML
  adapter is used in a mode that persists sessions to disk.
- Gateway management API (§6.3) should sit behind authentication before any
  non-local deployment — out of scope for the initial milestone, called out
  here so it isn't forgotten.

---

## 11. Testing Strategy

- **Unit tests** (Jest): every service in `packages/core`, mocking the
  repository interfaces.
- **Contract tests**: one shared test suite run three times — once per
  persistence adapter — asserting identical behavior (this is what makes
  LSP a verified property, not just an intention).
- **Integration tests** (Supertest): `/apps/:appKey` and the management API,
  against the in-memory adapter.
- **E2E** (Playwright Test): the login-capture flow against a disposable
  mock login page in CI (never against real github.com in automated tests).

---

## 12. Tooling & Build

- npm workspaces; root scripts: `build`, `lint`, `typecheck`, `test`,
  `test:contract`.
- `tsconfig.base.json` shared, strict mode on, each package extends it.
- CI (GitHub Actions): lint → typecheck → unit/contract tests → build, on
  every PR.

---

## 13. Phased Delivery Plan

1. `packages/core` (entities, ports, services) + unit tests.
2. `persistence-memory` + contract test suite established.
3. `persistence-yaml` + `seed-data/` convention + `seed:load`.
4. `gateway-server` (§6) + integration tests.
5. `cli` — `login` (Playwright capture, §7.2), `verify`, `endpoint:add`.
6. `persistence-oracle` against `config/db/postgres/database-schema.sql`.
7. Hardening: redaction, OpenAPI doc for the management API, CI pipeline.

---

## 14. Polyglot Portability Notes

This Node/TypeScript codebase is the **reference implementation**, not a
core that other languages call into. A future Python or pure-Java edition
re-implements:
- the same relational shape (`config/db/postgres/database-schema.sql`),
- the same YAML seed format (§5.3),
- the same REST contract (§6),
- the same CLI command surface (§7.1),

as an independent process with no shared runtime, no shelling out to Node,
and no shared `node_modules`/`pip`/JAR dependency. Keeping the contracts in
plain SQL/YAML/REST (rather than in TypeScript types) is what makes that
possible.

---

## 15. Glossary

- **App key** — short identifier for a downstream application, e.g.
  `copilot`.
- **Session credential** — the captured cookie jar + headers proving an
  authenticated session with a downstream app.
- **Endpoint definition** — the recorded shape (method, headers, body,
  response) of one HTTP endpoint belonging to an app.
- **Seed data** — the YAML files under `seed-data/` used to initialize any
  persistence backend.