import { container } from "tsyringe";
import { IAppRepository } from "@/ports/IAppRepository.js";
import { ISessionRepository } from "@/ports/ISessionRepository.js";
import { IEndpointRepository } from "@/ports/IEndpointRepository.js";
import { IAuditLogRepository } from "@/ports/IAuditLogRepository.js";
import { AppService } from "@/services/AppService.js";
import { SessionService } from "@/services/SessionService.js";
import { EndpointService } from "@/services/EndpointService.js";
import { CryptoService } from "@/services/CryptoService.js";
import { ProxyService } from "@/services/ProxyService.js";
import { AuditLogService } from "@/services/AuditLogService.js";

export { container };

/**
 * Configure dependency injection with the selected repositories.
 */
export function configureDI(repositories: {
  appRepository: IAppRepository;
  sessionRepository: ISessionRepository;
  endpointRepository: IEndpointRepository;
  auditLogRepository: IAuditLogRepository;
}) {
  container.registerInstance<IAppRepository>("IAppRepository", repositories.appRepository);
  container.registerInstance<ISessionRepository>("ISessionRepository", repositories.sessionRepository);
  container.registerInstance<IEndpointRepository>("IEndpointRepository", repositories.endpointRepository);
  container.registerInstance<IAuditLogRepository>("IAuditLogRepository", repositories.auditLogRepository);

  // Register services as singletons or direct injections
  container.registerSingleton(CryptoService);
  container.registerSingleton(AppService);
  container.registerSingleton(SessionService);
  container.registerSingleton(EndpointService);
  container.registerSingleton(ProxyService);
  container.registerSingleton(AuditLogService);
}
