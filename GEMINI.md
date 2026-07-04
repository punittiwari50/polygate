# Project: PolyGate — Unified Authenticated Application Gateway Platform

> This file is read automatically by **Gemini CLI** as hierarchical project
> memory (`/memory show` to inspect, `/memory refresh` after editing). It
> defines who you are building this project as, what to build, and how to
> build it. The linked specification files are part of this context, not
> optional reading — load them with `@docs/ARCHITECTURE.md` and
> `@config/db/postgres/database-schema.sql` if they are not already present in `/memory show`.

## 1. Role

You are acting as the **lead software architect and engineer** responsible
for scaffolding, implementing, and incrementally delivering **PolyGate**
inside this repository. Treat every instruction below as binding unless the
operator explicitly overrides it in chat.

## 2. What PolyGate Is

PolyGate is a self-hosted **authenticated application gateway** with a
companion **CLI + library**. It:

- Exposes a single HTTP entry point (default `http://localhost:8080`) that
  resolves a short **app key** (e.g. `copilot`) to a real upstream URL and
  transparently proxies/renders it.
- Lets an operator drive a real **GitHub login page** through the CLI, wait
  for login to succeed, capture the resulting **cookies and headers**, and
  persist them.
- Stores app→URL mappings, captured sessions, and endpoint definitions in a
  **relational schema** that can run on three interchangeable backends:
  **in-memory**, **YAML files**, **Oracle** (RDBMS), or **Redis** (NoSQL session store).
- Lets an operator record (via CLI) the HTTP method, headers, request body,
  and response body of any endpoint, turning that into well-organized
  **YAML seed data** that initializes the database.

The complete technical specification — ERD, DDL, gateway routing contract,
CLI command spec, persistence design, SOLID mapping, security model, and
phased delivery plan — is **not** duplicated here. It lives in:

- `docs/ARCHITECTURE.md` — full architecture and the Requirement
  Traceability Matrix resolving every ambiguity in the original brief.
- `docs/database-schema.sql` — canonical Oracle-compatible DDL that the
  YAML and in-memory adapters mirror.

Read both before generating code.

## 3. Non-Negotiable Constraints

1. **Language/runtime**: Node.js ≥ 20, **TypeScript in strict mode** for
   this implementation. Do not introduce Python or JVM tooling into this
   codebase — PolyGate is designed so Python or pure Java editions can be
   built later as **separate, independent** codebases sharing only the
   contracts in `docs/`, never as cross-process shims calling into this
   Node codebase.
2. **Architecture style**: layered
   (`controller → service → repository → model`) with **dependency
   injection** and **an interface for every persistence port**. New
   storage backends are added by implementing an interface — never by
   branching on the active driver inside business logic.
3. **SOLID, always** — see `docs/ARCHITECTURE.md §9` for the concrete
   mapping. If a change would violate SRP/OCP/DIP, redesign instead of
   patching around it.
4. **Security**: cookies and headers are secrets. Never write them to logs,
   console output, or seed YAML in plaintext — encrypt at rest
   (`docs/ARCHITECTURE.md §10`) and redact them in any printed
   request/response trace.
5. **No invented scope**: where a requirement was ambiguous, the resolution
   is already recorded in `docs/ARCHITECTURE.md §2`. Follow it rather than
   re-deciding it.
6. **Tests are part of "done"**: no feature is complete without unit tests
   for services/repositories, and an integration test for any new HTTP
   route.
7. **Path Aliasing**: Avoid using relative paths like `../` or `../../` for internal imports; instead, configure and use path aliases starting with `@/`.
8. **Optional Heavy Dependencies**: Drivers that require native binaries (`oracledb`, `ioredis`) MUST be declared as `optionalDependencies` and loaded via dynamic `import()` inside the factory — never eagerly at module load time. This ensures that a `--driver memory` start has zero Oracle/Redis code in the require graph.


## 4. Build Order

Work through these milestones in sequence; do not start milestone *n+1*
while milestone *n* has failing tests.

1. **Core domain** (`packages/core`) — entities, repository interfaces,
   services. No I/O, no framework.
2. **In-memory adapter** + unit tests, proving the domain layer is
   storage-agnostic.
3. **YAML adapter** + the `seed-data/` convention
   (`docs/ARCHITECTURE.md §5.3`) + `seed:load` CLI command.
4. **Gateway server** (`packages/gateway-server`) — `GET /apps/:appKey`
   per `docs/ARCHITECTURE.md §6`.
5. **CLI** (`packages/cli`) — `login`, `verify`, `endpoint:add`,
   `gateway:start`, using Playwright for the GitHub login capture flow.
6. **Oracle adapter** (`packages/persistence-oracle`) implementing the same
   repository interfaces against `docs/database-schema.sql`.
7. **Hardening pass** — secret-redacting structured logging, config
   validation, OpenAPI doc for the gateway's management API, CI workflow.

## 5. Definition of Done (per milestone)

- `npm run lint`, `npm run typecheck`, and `npm test` all pass.
- New public classes/functions have TSDoc comments.
- No secret (cookie/header/token) ever appears in a log line, a fixture
  committed to git, or an error message.
- `docs/ARCHITECTURE.md` updated if a behavior or contract actually changed
  (not just restated).

## 6. When You're Unsure

Ask the operator before guessing on: production database credentials, real
GitHub OAuth client IDs/secrets, or anything touching a real external
account. Everything else — file naming, exact CLI flag spelling, internal
helper structure — follow the conventions already set in
`docs/ARCHITECTURE.md`.

## 7. Development Environment Setup

To set up the development environment, configure the pnpm store and install dependencies:

```cmd
mkdir C:\Temp\pnpm-store
pnpm config set store-dir C:\Temp\pnpm-store
pnpm install
```

## 8. Golden Rules (Non-Negotiable on Every Code Change)

All coding standards, design-pattern requirements, and architectural constraints are maintained in a single canonical document:

**→ [`GOLDEN_RULES.md`](./GOLDEN_RULES.md) — read and follow this before every code change.**

The rules cover (Rules 1-7):
1. `@/` path aliases — never `./` or `../`
2. No `if/else/switch` — use Registry/Strategy/Chain-of-Responsibility patterns
3. OOP — classes, interfaces, polymorphism throughout
4. SOLID + loose coupling via DI and repository interfaces
5. Optional heavy dependencies via dynamic `import()` — zero Oracle/Redis in require graph when unused
6. No cyclic dependencies — acyclic module import graph, no circular service calls
7. Microservices & distributed system patterns — pooling, fast-fail, health probes, observability, stateless gateway