/**
 * Represents a login identity/credentials for a person on a specific application.
 */
export interface UserIdentity {
  id?: number;
  personId: number;
  appId: number;
  userId: string;
  authCredentials?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
