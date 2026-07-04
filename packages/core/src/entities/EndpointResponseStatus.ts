/**
 * Represents a mapped possible response HTTP code and meaning for an endpoint.
 */
export interface EndpointResponseStatus {
  id?: number;
  endpointId: number;
  statusCode: number;
  meaning: string;
  isSuccess: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
