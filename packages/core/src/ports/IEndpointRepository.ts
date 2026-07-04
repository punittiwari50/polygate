import { EndpointDefinition } from "../entities/EndpointDefinition.js";

export interface IEndpointRepository {
  list(appId: number): Promise<EndpointDefinition[]>;
  findByName(appId: number, name: string): Promise<EndpointDefinition | null>;
  upsert(def: EndpointDefinition): Promise<EndpointDefinition>;
}
