/**
 * Represents the definition and schema expectation of a proxy endpoint.
 */
export interface EndpointDefinition {
  id?: number;
  appId: number;
  versionId?: number;
  name: string;
  purposeId?: number;
  protocolType?: 'HTTP' | 'WEBSOCKET';
  path?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  wsUrlPath?: string;
  wsSubprotocol?: string;
  wsMessageSchema?: string;
  requiresAuth: boolean;
  requestHeaders?: Record<string, string>;
  requestBodySchema?: object;
  responseBodySchema?: object;
  sampleResponse?: any;
  description?: string;
  createdAt?: Date;
}
