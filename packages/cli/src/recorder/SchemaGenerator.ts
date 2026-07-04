/**
 * Generates JSON Schema draft-07 from arbitrary JavaScript objects/JSON payloads.
 */
export class SchemaGenerator {
  /**
   * Infers JSON schema of a given value recursively.
   * Highly resilient: never throws; falls back to an empty type definition.
   */
  public static infer(value: any): any {
    if (value === null) {
      return { type: "null" };
    }

    const type = typeof value;

    if (type === "string") {
      return { type: "string" };
    }

    if (type === "number") {
      return { type: Number.isInteger(value) ? "integer" : "number" };
    }

    if (type === "boolean") {
      return { type: "boolean" };
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return {
          type: "array",
          items: {}
        };
      }
      // Infer from the first item as a prototype
      return {
        type: "array",
        items: this.infer(value[0])
      };
    }

    if (type === "object") {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, val] of Object.entries(value)) {
        properties[key] = this.infer(val);
        required.push(key);
      }

      const schema: any = {
        type: "object",
        properties
      };

      if (required.length > 0) {
        schema.required = required;
      }

      return schema;
    }

    // Fallback/resilient default
    return {};
  }
}
