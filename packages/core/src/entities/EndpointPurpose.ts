/**
 * Represents the purpose/operation lookup mapping for endpoints.
 */
export interface EndpointPurpose {
  id?: number;
  purposeCode: string;
  displayName: string;
  createdAt?: Date;
  updatedAt?: Date;
}
