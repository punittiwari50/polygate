import { Application } from "../entities/Application.js";

export interface IAppRepository {
  findByKey(appKey: string): Promise<Application | null>;
  list(): Promise<Application[]>;
  upsert(app: Application): Promise<Application>;
}
