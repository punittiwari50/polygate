/**
 * Represents a physical person / platform user.
 */
export interface Person {
  id?: number;
  displayName: string;
  email: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt?: Date;
  updatedAt?: Date;
}
