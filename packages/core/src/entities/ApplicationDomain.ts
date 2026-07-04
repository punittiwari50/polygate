/**
 * Represents a domain category classification for applications (e.g. HOTEL, AIRLINE, BROKER).
 */
export interface ApplicationDomain {
  id?: number;
  domainCode: string;
  displayName: string;
  createdAt?: Date;
  updatedAt?: Date;
}
