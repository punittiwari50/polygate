/**
 * Represents structured parameter details for endpoint routing and validation.
 */
export interface EndpointParameter {
  id?: number;
  endpointId: number;
  paramName: string;
  location: 'PATH' | 'QUERY' | 'HEADER' | 'BODY';
  dataType: string;
  isRequired: boolean;
  defaultStaticValue?: string;
  isDynamic: boolean;
  isInternalOnly: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
