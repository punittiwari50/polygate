# Copilot Instructions — PolyGate

PolyGate is a self-hosted, authenticated application gateway with a CLI and
library. It maps short app keys (e.g. `copilot`) to real upstream URLs,
proxies/renders them behind `http://localhost:8080/apps/:appKey`, and
captures GitHub login session cookies/headers via CLI-driven browser
automation for storage and reuse.

Full architecture, requirement traceability, ERD, and DDL live in
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) and
[config/db/postgres/database-schema.sql](../config/db/postgres/database-schema.sql). Read these before
generating non-trivial code — do not re-derive the design from scratch, and
do not duplicate their content back into this file.

## Tech stack

- Node.js ≥ 20, TypeScript strict mode. Do not add Python or JVM code to
  this repository — future ports to those stacks are separate,
  independent codebases.
- npm workspaces monorepo: `packages/core`,
  `packages/persistence` (memory, yaml, oracle, redis adapters), `packages/gateway-server`,
  `packages/cli`.
- Express (or Fastify) for the gateway server; Playwright for
  browser-driven GitHub login capture; Zod for runtime schema validation;
  pino for logging.
- Jest + ts-jest for unit tests, Supertest for HTTP route tests.

## Coding guidelines

- Layered architecture: `controller → service → repository → model`.
  Controllers stay thin; business logic lives in services.
- Every persistence backend (in-memory, YAML, Oracle) implements the same
  repository interface from `packages/core` because that is how
  Open/Closed and Dependency Inversion are satisfied here — never add a
  storage-specific `if` branch inside `packages/core`.
- Use constructor-based dependency injection rather than service locators
  or ad hoc singletons.
- Validate all external input (HTTP request bodies, YAML seed files) with
  Zod before it reaches a service.
- Treat cookies, headers, and tokens as secrets: encrypt before
  persisting, never log them, never write them into committed seed YAML
  in plaintext.
- New code needs unit tests for services/repositories, and an integration
  test for any new HTTP route.
- `camelCase` for variables/functions, `PascalCase` for classes/interfaces,
  prefix repository interfaces with `I` (e.g. `IAppRepository`).

## Project structure

```
packages/
  core/                 # entities, repository interfaces, services — no I/O
  persistence-memory/
  persistence-yaml/
  persistence-oracle/
  gateway-server/       # GET /apps/:appKey reverse proxy + management API
  cli/                  # login, verify, endpoint:add, seed:load, gateway:start
seed-data/
  apps/<appKey>.yaml
  endpoints/<appKey>/<endpointName>.yaml
docs/
  ARCHITECTURE.md
  database-schema.sql
```

## Golden Rules (enforce on every code change)

All rules are maintained in the single canonical document:

**→ [`../GOLDEN_RULES.md`](../GOLDEN_RULES.md) — read this before every suggestion.**

Summary of the 7 rules:
1. `@/` path aliases — never `./` or `../`
2. No `if/else/switch` — Registry/Strategy/Chain-of-Responsibility patterns only
3. OOP — every backend is a class implementing a `@polygate/core` interface
4. SOLID + loose coupling — DI via tsyringe, interfaces everywhere
5. Optional heavy deps via `dynamic import()` — eager loading forbidden
6. No cyclic dependencies — acyclic package graph, no circular service calls
7. Microservices patterns — connection pooling, fast-fail, health probes, stateless gateway, external config

## Avoid

- Inventing a new gateway URL convention — the canonical route is
  `GET /apps/:appKey`; `GET /apps?key=<appKey>` is the only supported alias.
- Bypassing the repository interfaces to query a specific backend directly
  from a controller or CLI command.
- Adding a second logging or DI framework once one is chosen for a package.
- Fetching real GitHub credentials or committing `.env` files.
- Using relative path imports (`../` or `../../`) inside packages; configure and use path aliases starting with `@/` instead.

## Development setup

To configure the workspace and install packages, run the following setup commands:

```cmd
mkdir C:\Temp\pnpm-store
pnpm config set store-dir C:\Temp\pnpm-store
pnpm install
```