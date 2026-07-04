/**
 * IConnectionManager — universal contract for all database / cache connection managers.
 *
 * Both SQL (Oracle) and NoSQL (Redis) connection managers implement this interface,
 * enabling uniform health checking and lifecycle management from gateway and CLI code.
 *
 * Golden Rules satisfied:
 *  Rule 3 — OOP interface defining the connection manager contract.
 *  Rule 4 — ISP: interface is scoped solely to connection lifecycle.
 *  Rule 6 — Lives in @polygate/core so no package creates a cyclic dependency.
 *  Rule 7 — Supports Rule 7.1 (pooling), 7.2 (fast-fail), 7.3 (health probes).
 */
export interface IConnectionManager {
  /**
   * Establish the connection pool, reading parameters from the given config file path.
   * MUST implement fast-fail: throw within connectTimeoutMs if unreachable.
   *
   * @param configPath - Optional override path to the YAML connection config file.
   *                     Falls back to the driver-specific default under config/db/<driver>/.
   */
  connect(configPath?: string): Promise<void>;

  /**
   * Gracefully drain the connection pool and release all resources.
   * Must be called on process shutdown or SIGTERM.
   */
  close(): Promise<void>;

  /**
   * Executes a lightweight probe (PING / SELECT 1) to verify liveness.
   * Returns true if the backend is reachable, false otherwise.
   * Must resolve within a short timeout and never throw.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Whether the connection pool is currently considered healthy.
   * Reflects the result of the last health probe.
   */
  readonly isHealthy: boolean;
}
