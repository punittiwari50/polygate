import { injectable, inject } from "tsyringe";
import { IAppRepository } from "../ports/IAppRepository.js";
import { Application } from "../entities/Application.js";

@injectable()
export class AppService {
  constructor(
    @inject("IAppRepository")
    private appRepo: IAppRepository
  ) {}

  public async getAppByKey(appKey: string): Promise<Application | null> {
    return this.appRepo.findByKey(appKey);
  }

  public async listApps(): Promise<Application[]> {
    return this.appRepo.list();
  }

  public async upsertApp(app: Application): Promise<Application> {
    return this.appRepo.upsert(app);
  }
}
