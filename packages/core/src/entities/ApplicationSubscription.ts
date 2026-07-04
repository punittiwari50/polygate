/**
 * Represents subscription or plan tier metadata for an application.
 */
export interface ApplicationSubscription {
  id?: number;
  appId: number;
  planName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  startDate: Date;
  endDate?: Date;
  rateLimitRps: number;
  createdAt?: Date;
  updatedAt?: Date;
}
