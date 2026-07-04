import { injectable, inject } from "tsyringe";
import { ISessionRepository } from "@/ports/ISessionRepository.js";
import { IAppRepository } from "@/ports/IAppRepository.js";
import { CryptoService } from "@/services/CryptoService.js";
import { SessionCredential } from "@/entities/SessionCredential.js";
import { AuditLogService } from "@/services/AuditLogService.js";
import { Application, USER_ID_FALLBACK_NAMES } from "@/entities/Application.js";

// --- Design Pattern: Chain of Responsibility for extracting User ID from session payload ---

interface ISessionUserIdResolver {
  setNext(resolver: ISessionUserIdResolver): ISessionUserIdResolver;
  resolve(app: Application, cookies: any[], headers: Record<string, string>): string | undefined;
}

abstract class AbstractSessionUserIdResolver implements ISessionUserIdResolver {
  private nextResolver?: ISessionUserIdResolver;

  public setNext(resolver: ISessionUserIdResolver): ISessionUserIdResolver {
    this.nextResolver = resolver;
    return resolver;
  }

  public resolve(app: Application, cookies: any[], headers: Record<string, string>): string | undefined {
    const result = this.doResolve(app, cookies, headers);
    if (result) {
      return result;
    }
    return this.nextResolver?.resolve(app, cookies, headers);
  }

  protected abstract doResolve(
    app: Application,
    cookies: any[],
    headers: Record<string, string>
  ): string | undefined;
}

class SessionAppCookieResolver extends AbstractSessionUserIdResolver {
  protected doResolve(app: Application, cookies: any[]): string | undefined {
    if (app.userIdCookieName) {
      const cookie = cookies.find(c => c.name === app.userIdCookieName);
      if (cookie) return cookie.value;
    }
    return undefined;
  }
}


class SessionFallbackCookieResolver extends AbstractSessionUserIdResolver {
  protected doResolve(app: Application, cookies: any[]): string | undefined {
    const fallbackCookie = cookies.find(c => USER_ID_FALLBACK_NAMES.includes(c.name.toLowerCase()));
    if (fallbackCookie) return fallbackCookie.value;
    return undefined;
  }
}

@injectable()
export class SessionService {
  constructor(
    @inject("ISessionRepository")
    private sessionRepo: ISessionRepository,
    @inject("IAppRepository")
    private appRepo: IAppRepository,
    private cryptoService: CryptoService,
    private auditLogService: AuditLogService
  ) {}

  /**
   * Encrypts and saves captured cookies and headers as a session for the specified app key.
   */
  public async saveSession(
    appKey: string,
    cookies: any[],
    headers: Record<string, string>,
    expiresAt?: Date
  ): Promise<void> {
    const app = await this.appRepo.findByKey(appKey);
    if (!app || !app.id) {
      throw new Error(`Application with key ${appKey} not found.`);
    }

    // Extract userId dynamically using Chain of Responsibility Pattern
    const resolverChain = new SessionAppCookieResolver();
    resolverChain
      .setNext(new SessionFallbackCookieResolver());

    const userId = resolverChain.resolve(app, cookies, headers);

    // Invalidate existing active session for this app and user ID first to avoid overlaps
    const active = await this.sessionRepo.getActiveSession(app.id, userId);
    if (active && active.id) {
      await this.sessionRepo.invalidate(active.id);
    }

    const cookieStr = JSON.stringify(cookies);
    const headerStr = JSON.stringify(headers);

    const encryptedCookies = this.cryptoService.encrypt(cookieStr);
    const encryptedHeaders = this.cryptoService.encrypt(headerStr);

    const sessionUuid = this.cryptoService.generateUuid();

    const credential: SessionCredential = {
      appId: app.id,
      cookiePayload: encryptedCookies,
      headerPayload: encryptedHeaders,
      userId,
      sessionUuid,
      capturedAt: new Date(),
      expiresAt,
      isActive: true
    };

    await this.sessionRepo.saveSession(app.id, credential);

    await this.auditLogService.logAction("LOGIN", {
      appId: app.id,
      statusCode: 200,
      detail: `Successful login session captured and saved for user ${userId || "unknown"} (Session UUID: ${sessionUuid}). Cookies: ${cookies.length}, Headers: ${Object.keys(headers).length}`
    });
  }

  /**
   * Retrieves the active session for the given app key and decrypts the cookies/headers.
   */
  public async getActiveSession(
    appKey: string,
    sessionUuidOrUserId?: string
  ): Promise<{ cookies: any[]; headers: Record<string, string> } | null> {
    const app = await this.appRepo.findByKey(appKey);
    if (!app || !app.id) {
      return null;
    }

    const session = await this.sessionRepo.getActiveSession(app.id, sessionUuidOrUserId);
    if (!session) {
      return null;
    }

    // Soft delete/invalidate session if expired
    if (session.expiresAt && new Date() > session.expiresAt) {
      if (session.id) {
        await this.sessionRepo.invalidate(session.id);
      }
      return null;
    }

    try {
      const decryptedCookies = this.cryptoService.decrypt(session.cookiePayload);
      const decryptedHeaders = this.cryptoService.decrypt(session.headerPayload);

      return {
        cookies: JSON.parse(decryptedCookies),
        headers: JSON.parse(decryptedHeaders)
      };
    } catch (err) {
      // If decryption fails (e.g. key changed), invalidate the corrupted session
      if (session.id) {
        await this.sessionRepo.invalidate(session.id);
      }
      return null;
    }
  }

  /**
   * Lists captured sessions for the given app key.
   */
  public async listSessions(appKey: string): Promise<SessionCredential[]> {
    const app = await this.appRepo.findByKey(appKey);
    if (!app || !app.id) {
      return [];
    }
    return this.sessionRepo.listSessions(app.id);
  }

  /**
   * Invalidates (soft deletes) any active session for the given app key.
   */
  public async invalidateActiveSession(appKey: string, sessionUuidOrUserId?: string): Promise<void> {
    const app = await this.appRepo.findByKey(appKey);
    if (app && app.id) {
      const active = await this.sessionRepo.getActiveSession(app.id, sessionUuidOrUserId);
      if (active && active.id) {
        await this.sessionRepo.invalidate(active.id);
        
        await this.auditLogService.logAction("LOGOUT", {
          appId: app.id,
          statusCode: 200,
          detail: `Active session explicitly invalidated/logged out.`
        });
      }
    }
  }

  /**
   * Invalidates a session by ID.
   */
  public async invalidateSession(sessionId: number): Promise<void> {
    await this.sessionRepo.invalidate(sessionId);
    
    await this.auditLogService.logAction("LOGOUT", {
      statusCode: 200,
      detail: `Session ID ${sessionId} invalidated.`
    });
  }
}
