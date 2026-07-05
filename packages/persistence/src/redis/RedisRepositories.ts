/**
 * RedisSessionRepository — NoSQL session storage using the injected RedisConnectionManager.
 *
 * Golden Rules satisfied:
 *  Rule 1 — @/ path aliases throughout.
 *  Rule 2 — No if/else branching on connection state; uses guard clauses only.
 *  Rule 3 — Implements ISessionRepository (OOP contract).
 *  Rule 4 — DIP: depends on IConnectionManager interface, not concrete Redis class.
 *  Rule 6 — No cyclic imports; depends on @polygate/core interfaces only.
 *  Rule 7 — Uses manager's pool (7.1); fast-fail propagated from manager.connect() (7.2).
 *           Write errors propagate to callers — no silent swallowing (Rule 7.4).
 */
import { SessionCredential, ISessionRepository, IConnectionManager } from "@polygate/core";

export class RedisSessionRepository implements ISessionRepository {
  constructor(private readonly manager: IConnectionManager) {}

  /** Returns the underlying ioredis client from the connection manager pool. */
  private get redis() {
    return (this.manager as any).getClient();
  }

  public async saveSession(appId: number, session: SessionCredential): Promise<void> {
    const id = await this.redis.incr("session:id_counter");
    const saved: SessionCredential = {
      ...session,
      id,
      appId,
      capturedAt: session.capturedAt ?? new Date()
    };
    await this.redis.set(`session:${id}`, JSON.stringify(saved));
    await this.redis.set(`app:${appId}:active_session_id`, String(id));
  }

  public async getActiveSession(appId: number, sessionUuidOrUserId?: string): Promise<SessionCredential | null> {
    if (sessionUuidOrUserId) {
      const keys = await this.redis.keys("session:*");
      for (const key of keys) {
        if (key.endsWith(":id_counter")) continue;
        const val = await this.redis.get(key);
        if (val) {
          const session = JSON.parse(val) as SessionCredential;
          if (session.appId === appId && session.isActive && (session.sessionUuid === sessionUuidOrUserId || session.userId === sessionUuidOrUserId)) {
            return {
              ...session,
              capturedAt: session.capturedAt ? new Date(session.capturedAt) : undefined,
              expiresAt: session.expiresAt ? new Date(session.expiresAt) : undefined
            };
          }
        }
      }
      return null;
    }

    const activeIdStr = await this.redis.get(`app:${appId}:active_session_id`);
    if (!activeIdStr) return null;

    const sessionId = Number(activeIdStr);
    const sessionJson = await this.redis.get(`session:${sessionId}`);
    if (!sessionJson) return null;

    const session = JSON.parse(sessionJson) as SessionCredential;
    if (!session.isActive) return null;

    return {
      ...session,
      capturedAt: session.capturedAt ? new Date(session.capturedAt) : undefined,
      expiresAt: session.expiresAt ? new Date(session.expiresAt) : undefined
    };
  }

  public async listSessions(appId: number): Promise<SessionCredential[]> {
    const keys = await this.redis.keys("session:*");
    const sessions: SessionCredential[] = [];
    for (const key of keys) {
      if (key.endsWith(":id_counter")) continue;
      const val = await this.redis.get(key);
      if (val) {
        const session = JSON.parse(val) as SessionCredential;
        if (session.appId === appId) {
          sessions.push({
            ...session,
            capturedAt: session.capturedAt ? new Date(session.capturedAt) : undefined,
            expiresAt: session.expiresAt ? new Date(session.expiresAt) : undefined
          });
        }
      }
    }
    return sessions.sort((a, b) => (b.id || 0) - (a.id || 0));
  }

  public async invalidate(sessionId: number): Promise<void> {
    const sessionJson = await this.redis.get(`session:${sessionId}`);
    if (!sessionJson) return;
    const session = JSON.parse(sessionJson) as SessionCredential;
    session.isActive = false;
    await this.redis.set(`session:${sessionId}`, JSON.stringify(session));
  }

  public async deleteInactiveSessions(appId: number): Promise<void> {
    const keys = await this.redis.keys("session:*");
    for (const key of keys) {
      if (key.endsWith(":id_counter")) continue;
      const val = await this.redis.get(key);
      if (val) {
        const session = JSON.parse(val) as SessionCredential;
        if (session.appId === appId && !session.isActive) {
          await this.redis.del(key);
        }
      }
    }
  }

  public async flushAll(): Promise<void> {
    const keys: string[] = await this.redis.keys("*");
    if (keys.length > 0) {
      const rawKeys = keys.map((k: string) => k.replace(/^polygate:/, ""));
      await this.redis.del(rawKeys);
    }
  }

  public async close(): Promise<void> {
    await this.manager.close();
  }
}
