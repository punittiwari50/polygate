import "reflect-metadata";

export const version = "1.0.0";

// Entities
export * from "@/entities/Application.js";
export * from "@/entities/SessionCredential.js";
export * from "@/entities/EndpointDefinition.js";
export * from "@/entities/AuditLog.js";
export * from "@/entities/ApplicationDomain.js";
export * from "@/entities/AppAccessChannel.js";
export * from "@/entities/ApplicationVersion.js";
export * from "@/entities/ApplicationSubscription.js";
export * from "@/entities/Person.js";
export * from "@/entities/UserIdentity.js";
export * from "@/entities/EndpointPurpose.js";
export * from "@/entities/EndpointResponseStatus.js";
export * from "@/entities/EndpointParameter.js";

// Ports (interfaces)
export * from "@/ports/IAppRepository.js";
export * from "@/ports/ISessionRepository.js";
export * from "@/ports/IEndpointRepository.js";
export * from "@/ports/IAuditLogRepository.js";
export * from "@/ports/IConnectionManager.js";

// Services
export * from "@/services/CryptoService.js";
export * from "@/services/AppService.js";
export * from "@/services/SessionService.js";
export * from "@/services/EndpointService.js";
export * from "@/services/ProxyService.js";
export * from "@/services/AuditLogService.js";

// DI Configuration
export * from "@/di.js";
