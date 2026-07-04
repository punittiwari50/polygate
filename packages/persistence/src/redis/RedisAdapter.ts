/**
 * RedisPersistenceAdapter — assembles the Redis-backed persistence adapter.
 *
 * Loaded exclusively via dynamic import() from PersistenceAdapterFactory when
 * --driver redis is selected. Never imported statically.
 *
 * Golden Rules satisfied:
 *  Rule 1 — @/ path aliases throughout.
 *  Rule 3 — Implements PersistenceAdapter shape (OOP/polymorphism).
 *  Rule 4 — SRP: single responsibility is wiring the Redis adapter components.
 *  Rule 5 — Not statically imported; ioredis enters the require graph only here.
 *  Rule 6 — No circular imports.
 *  Rule 7 — Delegates pooling + fast-fail to RedisConnectionManager (7.1, 7.2).
 */
import { RedisConnectionManager } from "@/redis/RedisConnectionManager.js";
import { RedisSessionRepository } from "@/redis/RedisRepositories.js";
import { MemoryAppRepository, MemoryEndpointRepository, MemoryAuditLogRepository } from "@/memory/MemoryRepositories.js";

export class RedisPersistenceAdapter {
  public readonly appRepository = new MemoryAppRepository();
  public readonly sessionRepository: RedisSessionRepository;
  public readonly endpointRepository = new MemoryEndpointRepository();
  public readonly auditLogRepository = new MemoryAuditLogRepository();

  /** The connection manager — exposed for lifecycle management (connect/close/health). */
  public readonly connectionManager: RedisConnectionManager;

  constructor(options: { configPath?: string } = {}) {
    this.connectionManager = new RedisConnectionManager();
    this.sessionRepository = new RedisSessionRepository(this.connectionManager);
  }

  /**
   * Connect to Redis using the config file.
   * Must be called once before any repository operations.
   * Delegates fast-fail and pooling to RedisConnectionManager.
   */
  public async connect(configPath?: string): Promise<void> {
    await this.connectionManager.connect(configPath);
  }
}

export default RedisPersistenceAdapter;
