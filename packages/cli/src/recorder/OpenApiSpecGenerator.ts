import { Application, EndpointDefinition } from "@polygate/core";

export class OpenApiSpecGenerator {
  public static generate(app: Application, endpoints: EndpointDefinition[]): any {
    const paths: Record<string, any> = {};

    for (const ep of endpoints) {
      if (!ep.path) continue;
      const cleanPath = ep.path.startsWith("/") ? ep.path : `/${ep.path}`;
      const method = (ep.httpMethod || "GET").toLowerCase();

      if (!paths[cleanPath]) {
        paths[cleanPath] = {};
      }

      // Convert requestHeaders to parameters
      const parameters: any[] = [];
      if (ep.requestHeaders) {
        for (const [headerName, val] of Object.entries(ep.requestHeaders)) {
          parameters.push({
            name: headerName,
            in: "header",
            required: val === "required",
            schema: {
              type: "string",
              default: val
            }
          });
        }
      }

      const operation: any = {
        summary: ep.name,
        description: ep.description || `Captured API Endpoint for ${app.appKey}.`,
        operationId: ep.name
      };

      if (parameters.length > 0) {
        operation.parameters = parameters;
      }

      if (ep.requiresAuth) {
        operation.security = [{ bearerAuth: [] }];
      }

      if (ep.requestBodySchema) {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: ep.requestBodySchema
            }
          }
        };
      }

      if (ep.responseBodySchema) {
        operation.responses = {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: ep.responseBodySchema
              }
            }
          }
        };
      } else {
        operation.responses = {
          "200": {
            description: "Successful response"
          }
        };
      }

      paths[cleanPath][method] = operation;
    }

    const openApiDoc: any = {
      openapi: "3.0.3",
      info: {
        title: app.displayName || app.appKey,
        version: "1.0.0",
        description: `OpenAPI specification for PolyGate app: ${app.appKey}`
      },
      servers: [
        {
          url: app.baseUrl || "http://localhost"
        }
      ],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer"
          }
        }
      },
      // PolyGate custom extensions
      "x-polygate-app-key": app.appKey,
      "x-polygate-display-name": app.displayName,
      "x-polygate-auth-type": app.authType || "NONE",
      "x-polygate-status": app.status || "ACTIVE",
      "x-polygate-login-url": app.loginUrl,
      "x-polygate-login-success-url-pattern": app.loginSuccessUrlPattern,
      "x-polygate-login-success-cookie-name": app.loginSuccessCookieName,
      "x-polygate-session-injection-rules": app.sessionInjectionRules,
      "x-polygate-user-id-cookie-name": app.userIdCookieName,
      "x-polygate-session-capture-headers": app.sessionCaptureHeaders
    };

    return openApiDoc;
  }
}
