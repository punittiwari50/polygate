/**
 * Represents a version mapping associated with an access channel.
 */
export interface ApplicationVersion {
  id?: number;
  channelId: number;
  versionLabel: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  isCurrent: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
