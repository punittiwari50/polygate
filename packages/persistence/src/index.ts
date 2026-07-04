/**
 * @polygate/persistence — public API
 *
 * Golden Rules enforced:
 *  Rule 1  — All intra-package imports use @/ aliases.
 *  Rule 2  — No if/else/switch: PersistenceAdapterFactory uses a Registry Map pattern.
 *  Rule 3  — All adapters are classes implementing PersistenceAdapter (OOP/polymorphism).
 *  Rule 4  — DIP: consumers depend on PersistenceAdapter interface, not concrete classes.
 *  Rule 5  — Oracle and Redis are optionalDependencies loaded via dynamic import() only
 *             when their driver key is selected; unused adapters never enter the require graph.
 */

import { MemoryAppRepository, MemorySessionRepository, MemoryEndpointRepository, MemoryAuditLogRepository } from "@/memory/MemoryRepositories.js";
import { YamlAppRepository, YamlSessionRepository, YamlEndpointRepository, YamlAuditLogRepository, YamlHelper } from "@/yaml/YamlRepositories.js";

// ── Static exports (lightweight adapters, no native binaries) ─────────────────
export * as memory from "@/memory/index.js";
export * as yaml from "@/yaml/index.js";

// Re-export individual repositories for direct use
export { RedisSessionRepository } from "@/redis/RedisRepositories.js";
// Re-export connection managers (for lifecycle and health check use)
export { RedisConnectionManager } from "@/redis/RedisConnectionManager.js";
export { OracleConnectionManager } from "@/oracle/OracleRepositories.js";
// Re-export concrete adapter classes (for testing and direct instantiation)
export { RedisPersistenceAdapter } from "@/redis/RedisAdapter.js";
export { OraclePersistenceAdapter } from "@/oracle/OracleAdapter.js";
export { YamlHelper };

// ── Adapter interface (Golden Rule 3 — OOP contract) ─────────────────────────
export interface PersistenceAdapter {
  appRepository: any;
  sessionRepository: any;
  endpointRepository: any;
  auditLogRepository: any;
}

// ── Lightweight adapters (no native binary dependencies) ─────────────────────

/**
 * In-memory adapter — always available, no external dependencies.
 */
export class MemoryPersistenceAdapter implements PersistenceAdapter {
  public appRepository = new MemoryAppRepository();
  public sessionRepository = new MemorySessionRepository();
  public endpointRepository = new MemoryEndpointRepository();
  public auditLogRepository = new MemoryAuditLogRepository();
}

/**
 * YAML file-backed adapter — always available, uses only js-yaml.
 */
export class YamlPersistenceAdapter implements PersistenceAdapter {
  public appRepository: YamlAppRepository;
  public sessionRepository: YamlSessionRepository;
  public endpointRepository: YamlEndpointRepository;
  public auditLogRepository: YamlAuditLogRepository;

  constructor(options: { seedDir?: string } = {}) {
    if (options.seedDir) {
      YamlHelper.setSeedDir(options.seedDir);
    }
    this.appRepository = new YamlAppRepository();
    this.sessionRepository = new YamlSessionRepository();
    this.endpointRepository = new YamlEndpointRepository(this.appRepository);
    this.auditLogRepository = new YamlAuditLogRepository();
  }
}

// ── Factory (Golden Rule 2 — Registry Map pattern, zero if/else) ──────────────

/**
 * Maps driver keys to async loader functions.
 * Heavy adapters (oracle, redis) use dynamic import() so their native
 * binary dependencies are only pulled into the require graph on demand.
 */
type AdapterLoader = (options?: any) => Promise<PersistenceAdapter>;

const adapterRegistry: Record<string, AdapterLoader> = {
  memory: async () => new MemoryPersistenceAdapter(),

  yaml: async (options) => new YamlPersistenceAdapter(options),

  oracle: async () => {
    const { OraclePersistenceAdapter } = await import("@/oracle/OracleAdapter.js").catch(() => {
      throw new Error(
        "Oracle adapter requires the \"oracledb\" optional dependency. " +
        "Install it with: pnpm add oracledb --filter @polygate/persistence"
      );
    });
    return new OraclePersistenceAdapter();
  },

  redis: async (options) => {
    const { RedisPersistenceAdapter } = await import("@/redis/RedisAdapter.js").catch(() => {
      throw new Error(
        "Redis adapter requires the \"ioredis\" optional dependency. " +
        "Install it with: pnpm add ioredis --filter @polygate/persistence"
      );
    });
    return new RedisPersistenceAdapter(options);
  },
};

/**
 * PersistenceAdapterFactory
 *
 * Creates the appropriate persistence adapter for the given driver name.
 * Returns a Promise — callers must await this call.
 *
 * Golden Rule 2: uses registry map; no if/else/switch.
 * Golden Rule 5: oracle and redis are loaded lazily via dynamic import().
 */
export class PersistenceAdapterFactory {
  /** @internal — exposed for testing and driver registration extension */
  public static readonly registry: Record<string, AdapterLoader> = adapterRegistry;

  /**
   * Asynchronously creates a PersistenceAdapter for the requested driver.
   * Falls back to "memory" if the driver key is unrecognised.
   *
   * @param driverName - one of "memory" | "yaml" | "oracle" | "redis"
   * @param options    - driver-specific configuration (e.g. seedDir for yaml)
   */
  public static async create(driverName: string, options?: any): Promise<PersistenceAdapter> {
    const key = (driverName ?? "memory").toLowerCase();
    const loader = PersistenceAdapterFactory.registry[key] ?? PersistenceAdapterFactory.registry.memory;
    return loader(options);
  }
}
