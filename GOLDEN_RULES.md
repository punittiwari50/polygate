# PolyGate — Golden Rules

> **Authoritative Reference.** This file is the single source of truth for all coding standards in the PolyGate repository. It is referenced by `GEMINI.md` and `.github/copilot-instructions.md`. Every rule is non-negotiable — any code change that violates a rule **must be redesigned** before it is merged.

---

## Rule 1 — Path Aliases (`@/`), Never Relative Paths

All intra-package imports MUST use the `@/` alias configured in each package's `tsconfig.json`. Relative paths (`./`, `../`) are **forbidden** for cross-directory imports inside a package.

```typescript
// ✅ Correct
import { AppService } from "@/services/AppService.js";
import { ISessionRepository } from "@polygate/core";

// ❌ Forbidden
import { AppService } from "../../services/AppService.js";
import { ISessionRepository } from "../../../core/src/ports/ISessionRepository.js";
```

**Why:** Relative paths break when files are moved, create opaque import chains, and make refactoring expensive. Aliases make dependency intent explicit and location-independent.

**Tooling:** `tsconfig.json` `paths` map + `tsc-alias` for compiled output + `ts-node -r ./src/register-paths.ts` for runtime.

---

## Rule 2 — No `if` / `if..else` / `switch` — Use Design Patterns

Branching on type, driver name, or strategy inside **business logic** violates the Open/Closed Principle. Every `if/else` chain is a latent OCP violation waiting to break.

**Permitted alternatives:**

| Pattern | When to use |
|---------|-------------|
| **Registry / Map** | Driver selection, command dispatch, handler lookup |
| **Strategy** | Interchangeable algorithm families (encryption, serialisation) |
| **Chain of Responsibility** | Middleware pipelines, validation chains |
| **Null Object** | Replace `null`-guard `if` checks with a no-op implementation |
| **Guard clause** | One-line early return at the top of a function for invalid input only |

```typescript
// ✅ Registry Map — zero if/else
const registry: Record<string, AdapterLoader> = {
  memory: async () => new MemoryPersistenceAdapter(),
  yaml:   async (o) => new YamlPersistenceAdapter(o),
  oracle: async () => { const { OraclePersistenceAdapter } = await import("@/oracle/OracleAdapter.js"); return new OraclePersistenceAdapter(); },
  redis:  async (o) => { const { RedisPersistenceAdapter } = await import("@/redis/RedisAdapter.js"); return new RedisPersistenceAdapter(o); },
};
const loader = registry[driver] ?? registry.memory;
return loader(options);

// ❌ Forbidden — branching on driver
if (driver === "yaml") { ... }
else if (driver === "oracle") { ... }
else { ... }
```

**Guard clauses (acceptable):**
```typescript
// ✅ Single early-return guard at function entry
public async getActiveSession(appId: number) {
  if (!appId) return null;   // guard clause — not branching logic
  ...
}
```

---

## Rule 3 — OOP: Classes, Interfaces, Polymorphism

- **Every persistence backend** implements a repository interface from `@polygate/core` (e.g. `IAppRepository`, `ISessionRepository`). Callers depend on the interface, never the concrete class.
- **Every connection manager** implements `IConnectionManager` from `@polygate/core`.
- **Favour composition** over inheritance. Use abstract classes only for genuine shared behaviour with multiple concrete variants.
- **No top-level stateful free functions.** State-holding logic must live inside a class.
- **Naming conventions:** `PascalCase` for classes/interfaces; `I` prefix for interfaces (`IAppRepository`); `camelCase` for methods and variables.

```typescript
// ✅ Interface → concrete class → consumer depends only on interface
export class RedisSessionRepository implements ISessionRepository { ... }
export class MemorySessionRepository implements ISessionRepository { ... }

// ✅ Connection manager follows the same pattern
export class RedisConnectionManager implements IConnectionManager { ... }
export class OracleConnectionManager implements IConnectionManager { ... }
```

---

## Rule 4 — SOLID + Loose Coupling

All five SOLID principles apply to every class in this repository:

| Principle | Requirement |
|-----------|-------------|
| **S**RP — Single Responsibility | Each class has exactly one reason to change. Controllers route HTTP. Services orchestrate business rules. Repositories translate between domain objects and storage. Connection managers own the connection lifecycle only. |
| **O**CP — Open/Closed | Adding a new storage driver requires implementing an interface and adding one registry entry. No existing class is modified. |
| **L**SP — Liskov Substitution | All `IXxxRepository` and `IConnectionManager` implementations must be fully substitutable. A caller passing `ISessionRepository` must not know or care whether the backing store is memory, YAML, Oracle, or Redis. |
| **I**SP — Interface Segregation | Repository interfaces are split by concern: `IAppRepository`, `ISessionRepository`, `IEndpointRepository`, `IAuditLogRepository`. Do not add methods to an interface that all implementations would leave empty. |
| **D**IP — Dependency Inversion | `@polygate/core` defines interfaces. `@polygate/persistence` implements them. `@polygate/gateway-server` and `@polygate/cli` consume interfaces only — never concrete adapter classes. Dependency injection is managed by **tsyringe**; never `new` a service inside another service. |

---

## Rule 5 — Optional Heavy Dependencies via Dynamic `import()`

Drivers that require native binaries (`oracledb`, `ioredis`) MUST be declared as `optionalDependencies` in `package.json` and loaded via dynamic `import()` **inside the factory**, never at module load time.

```typescript
// ✅ Lazy load — oracle binary never touched when driver is "memory"
oracle: async () => {
  const { OraclePersistenceAdapter } = await import("@/oracle/OracleAdapter.js").catch(() => {
    throw new Error("Install oracledb: pnpm add oracledb --filter @polygate/persistence");
  });
  return new OraclePersistenceAdapter();
},
```

**Consequence:** A `--driver memory` process starts with **zero** Oracle/Redis code in the require graph. Any adapter-specific import at the module's top level is a violation.

**Connection config** for heavy adapters (Oracle, Redis) lives in structured YAML files under `config/db/<driver>/`, not hardcoded in source. Connection managers read these files at `connect()` time, not at import time.

---

## Rule 6 — No Cyclic Dependencies

Cyclic dependencies — whether in the module import graph, in service call chains, or in data flow — are **forbidden**.

### 6.1 Module Import Graph

The dependency arrow must always flow in one direction:

```
@polygate/core  ←  @polygate/persistence  ←  @polygate/gateway-server  ←  @polygate/cli
```

- `@polygate/core` imports from **nothing inside the monorepo**.
- `@polygate/persistence` may import from `@polygate/core` only.
- `@polygate/gateway-server` may import from `@polygate/core` and `@polygate/persistence` only.
- `@polygate/cli` may import from all three.

**Detecting violations:**
```powershell
pnpm exec madge --circular --extensions ts packages/
```

### 6.2 Service Call Cycles

No service may directly or transitively call back into itself:

```
// ❌ Forbidden — cyclic service chain
AppService → SessionService → AppService
```

Services communicate through domain events or returned values only. If two services mutually need each other, extract the shared concern into a third service.

### 6.3 Intra-Package Cycles

Within a package, files must form a directed acyclic graph. Circular `import` chains between files in the same package are forbidden. Use interfaces and dependency injection to break any cycle — not `require()` deferred imports.

### 6.4 Data Flow Cycles

A request must have a single, forward-moving processing pipeline:

```
HTTP Request → Controller → Service → Repository → Storage
                                                       ↓
HTTP Response ← Controller ← Service ← Repository ← Result
```

No backwards callbacks from Repository to Service to Controller during a single request.

---

## Rule 7 — Microservices & Distributed System Patterns

Each `packages/*` directory is an independently deployable unit. Code must be written for the realities of a distributed system: partial failures, network latency, and independent scaling.

### 7.1 Connection Pooling

Every database or cache driver MUST use a connection pool. Direct per-request connection creation is forbidden.

```typescript
// ✅ Pool managed by the connection manager
export class RedisConnectionManager implements IConnectionManager {
  private pool: Redis;  // ioredis manages an internal pool

  public async connect(configPath?: string): Promise<void> {
    const config = await this.configLoader.load(configPath);
    this.pool = new Redis({ ...config.connection, ...config.pool });
    await this.healthCheck();  // fast-fail on startup
  }

  public getClient(): Redis { return this.pool; }
}
```

### 7.2 Fast-Fail

Connection attempts MUST have a hard timeout. If a connection cannot be established within `connectTimeoutMs` (default: 1500 ms), throw a descriptive error immediately rather than hanging.

```typescript
// ✅ Fast-fail pattern
private async connectWithTimeout(client: Redis, timeoutMs: number): Promise<void> {
  const connectPromise = new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Redis connection timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  await Promise.race([connectPromise, timeoutPromise]);
}
```

### 7.3 Health Probes

Every connection manager must expose a `healthCheck(): Promise<boolean>` method. The gateway management API (`GET /api/health`) aggregates health probe results from all registered managers.

### 7.4 Graceful Degradation

- Prefer returning `null` or an empty result over throwing for read operations when the backend is temporarily unavailable.
- Write operations must propagate errors to the caller — do not silently swallow write failures.
- Do not silently fall back to a different storage backend at runtime (the current mock-fallback in `RedisSessionRepository` is being removed in favour of fast-fail).

### 7.5 Stateless Gateway

The gateway server process is stateless. It must start cleanly on any host given only its configuration and a reachable persistence backend. No in-process cache or global mutable singleton may hold user-facing data across requests.

### 7.6 Configuration Externalisation

All connection parameters (host, port, pool size, timeouts) live in `config/db/<driver>/<driver>-connection.yaml`. Environment-variable substitution (`${ENV_VAR}`) is resolved at startup. No connection parameter is hardcoded in TypeScript source.

### 7.7 Idempotent Seed Operations

`seed:load` operations must be idempotent — running them twice must not create duplicate data. Use upsert semantics (`ON CONFLICT DO UPDATE` for SQL; `SET` for Redis; Map-key overwrite for memory/YAML).

### 7.8 Observability

Every cross-service call (proxy, session store read/write, DB query) must emit a structured log entry via `pino` with:
- `appKey` (when applicable)
- target URL or storage key
- HTTP method / operation name
- response status code or error type
- duration in milliseconds

Secrets (cookies, headers, tokens) must be redacted in all log entries.
