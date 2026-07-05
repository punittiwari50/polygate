import { SessionCredential } from "../entities/SessionCredential.js";

export interface ISessionRepository {
  saveSession(appId: number, session: SessionCredential): Promise<void>;
  getActiveSession(appId: number, sessionUuidOrUserId?: string): Promise<SessionCredential | null>;
  listSessions(appId: number): Promise<SessionCredential[]>;
  invalidate(sessionId: number): Promise<void>;
  deleteInactiveSessions(appId: number): Promise<void>;
}
