import { injectable, inject } from "tsyringe";
import { IEndpointRepository } from "../ports/IEndpointRepository.js";
import { IAppRepository } from "../ports/IAppRepository.js";
import { EndpointDefinition } from "../entities/EndpointDefinition.js";

@injectable()
export class EndpointService {
  constructor(
    @inject("IEndpointRepository")
    private endpointRepo: IEndpointRepository,
    @inject("IAppRepository")
    private appRepo: IAppRepository
  ) {}

  public async listEndpoints(appKey: string): Promise<EndpointDefinition[]> {
    const app = await this.appRepo.findByKey(appKey);
    if (!app || !app.id) {
      return [];
    }
    return this.endpointRepo.list(app.id);
  }

  public async getEndpointByName(
    appKey: string,
    name: string
  ): Promise<EndpointDefinition | null> {
    const app = await this.appRepo.findByKey(appKey);
    if (!app || !app.id) {
      return null;
    }
    return this.endpointRepo.findByName(app.id, name);
  }

  public async upsertEndpoint(
    appKey: string,
    def: Omit<EndpointDefinition, "appId">
  ): Promise<EndpointDefinition> {
    const app = await this.appRepo.findByKey(appKey);
    if (!app || !app.id) {
      throw new Error(`Application with key ${appKey} not found.`);
    }

    const fullDef: EndpointDefinition = {
      ...def,
      appId: app.id
    };

    return this.endpointRepo.upsert(fullDef);
  }
}
