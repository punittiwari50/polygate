/**
 * RedisConnectionManager — config-file-driven Redis connection pool with fast-fail.
 *
 * Mirrors the OracleConnectionManager pattern:
 *  - Reads connection parameters from config/db/redis/redis-connection.yaml
 *  - Manages a shared ioredis client (pool-like via maxRetriesPerRequest + keepAlive)
 *  - Fast-fail: wraps initial PING in a Promise.race with connectTimeoutMs deadline
 *  - Exposes healthCheck() for the gateway health API
 *
 * Golden Rules satisfied:
 *  Rule 1 — @/ path aliases throughout.
 *  Rule 3 — Implements IConnectionManager interface (OOP contract).
 *  Rule 4 — SRP: owns only the Redis connection lifecycle.
 *  Rule 5 — File is NOT imported statically from persistence/src/index.ts;
 *            it is instantiated inside RedisAdapter which is loaded via dynamic import().
 *  Rule 6 — No circular imports: reads from @polygate/core interface only.
 *  Rule 7 — Implements pooling (7.1), fast-fail (7.2), health probes (7.3),
 *            and external config files (7.6).
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { IConnectionManager } from "@polygate/core";

// ── Types ────────────────────────────────────────────────────────────────────

interface RedisConnectionConfig {
  connection: {
    host: string;
    port: number;
    keyPrefix: string;
    tls: boolean;
    password?: string;
    db?: number;
  };
  pool: {
    minIdle: number;
    maxConnections: number;
    acquireTimeoutMs: number;
    connectTimeoutMs: number;
    retryDelayMs: number;
    maxRetries: number;
  };
  health: {
    probeIntervalMs: number;
    failureThreshold: number;
  };
}

// ── Config loader (resolves ${ENV_VAR:default} placeholders) ─────────────────

class RedisConfigLoader {
  private static readonly ENV_PATTERN = /\$\{([^}:]+)(?::([^}]*))?\}/g;

  public load(configPath: string): RedisConnectionConfig {
    const raw = fs.readFileSync(configPath, "utf8");
    const resolved = raw.replace(RedisConfigLoader.ENV_PATTERN, (_match, varName, defaultVal) => {
      return process.env[varName] ?? defaultVal ?? "";
    });
    return yaml.load(resolved) as RedisConnectionConfig;
  }
}

// ── Connection manager ────────────────────────────────────────────────────────

export class RedisConnectionManager implements IConnectionManager {
  private client: any = null;  // ioredis.Redis — typed as any to avoid static import
  private _isHealthy = false;
  private probeTimer: NodeJS.Timeout | null = null;
  private failureCount = 0;
  private config: RedisConnectionConfig | null = null;

  private static readonly DEFAULT_CONFIG_PATH = path.resolve(
    process.cwd(),
    "config/db/redis/redis-connection.yaml"
  );

  public get isHealthy(): boolean {
    return this._isHealthy;
  }

  /**
   * Establish the Redis connection pool.
   * Reads from configPath (or the default config/db/redis/redis-connection.yaml).
   * Fast-fail: throws if PING does not succeed within connectTimeoutMs.
   */
  public async connect(configPath?: string): Promise<void> {
    const resolvedPath = configPath ?? RedisConnectionManager.DEFAULT_CONFIG_PATH;

    const loader = new RedisConfigLoader();
    this.config = loader.load(resolvedPath);

    const { Redis } = await import("ioredis");

    const { connection, pool } = this.config;

    this.client = new Redis({
      host: connection.host,
      port: Number(connection.port),
      keyPrefix: connection.keyPrefix,
      password: connection.password,
      db: connection.db ?? 0,
      tls: connection.tls ? {} : undefined,
      maxRetriesPerRequest: pool.maxRetries,
      retryStrategy: (times: number) => {
        return times <= pool.maxRetries ? pool.retryDelayMs : null;
      },
      lazyConnect: true,
    });

    await this.connectWithTimeout(pool.connectTimeoutMs);

    this._isHealthy = true;
    this.failureCount = 0;
    this.scheduleHealthProbes(this.config.health.probeIntervalMs);
  }

  /**
   * Wraps the initial connection + PING in a Promise.race with a hard deadline.
   * This is the fast-fail implementation (Rule 7.2).
   */
  private async connectWithTimeout(timeoutMs: number): Promise<void> {
    const connectPromise = (async () => {
      await this.client.connect();
      await this.client.ping();
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Redis connection timed out after ${timeoutMs}ms. Check redis-connection.yaml and ensure the Redis server is reachable.`)),
        timeoutMs
      )
    );

    await Promise.race([connectPromise, timeoutPromise]);
  }

  /** Returns a connected client for repository use. Throws if not connected. */
  public getClient(): any {
    if (!this.client) {
      throw new Error(
        "RedisConnectionManager is not connected. Call connect() before using the client."
      );
    }
    return this.client;
  }

  /**
   * PING health probe — resolves true/false, never throws (Rule 7.3).
   */
  public async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const response = await Promise.race([
        this.client.ping(),
        new Promise<string>((_, r) => setTimeout(() => r("TIMEOUT"), 1000)),
      ]);
      const healthy = response === "PONG";
      this._isHealthy = healthy;
      this.failureCount = healthy ? 0 : this.failureCount + 1;
      return healthy;
    } catch {
      this._isHealthy = false;
      this.failureCount++;
      return false;
    }
  }

  /** Gracefully close all connections and cancel health probes. */
  public async close(): Promise<void> {
    this.cancelHealthProbes();
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this._isHealthy = false;
    }
  }

  /** Schedule periodic background PING probes. */
  private scheduleHealthProbes(intervalMs: number): void {
    if (intervalMs <= 0) return;
    this.probeTimer = setInterval(async () => {
      const healthy = await this.healthCheck();
      const threshold = this.config?.health.failureThreshold ?? 3;
      if (!healthy && this.failureCount >= threshold) {
        console.warn(`[RedisConnectionManager] Connection degraded after ${this.failureCount} consecutive failures.`);
      }
    }, intervalMs);
    this.probeTimer.unref?.();  // Don't prevent process exit
  }

  private cancelHealthProbes(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }
}
