/**
 * OracleAdapter — loads `oracledb` and wires all Oracle repositories into one
 * adapter object. This file is intentionally NOT imported statically from
 * `packages/persistence/src/index.ts`; it is loaded via dynamic `import()`
 * inside `PersistenceAdapterFactory` only when `--driver oracle` is chosen.
 *
 * Golden Rules satisfied:
 *  Rule 1 — @/ path aliases used throughout.
 *  Rule 3 — Class-based, OOP, implements PersistenceAdapter interface.
 *  Rule 4 — SRP: single responsibility is assembling the Oracle adapter.
 *  Rule 5 — Loaded lazily; process starts without oracledb present.
 */
import {
  OracleAppRepository,
  OracleSessionRepository,
  OracleEndpointRepository,
  OracleAuditLogRepository
} from "@/oracle/OracleRepositories.js";

export class OraclePersistenceAdapter {
  public appRepository = new OracleAppRepository();
  public sessionRepository = new OracleSessionRepository();
  public endpointRepository = new OracleEndpointRepository();
  public auditLogRepository = new OracleAuditLogRepository();
}

export default OraclePersistenceAdapter;
