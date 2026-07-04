import {
  SqlDialectGenerator,
  PostgresGenerator,
  MysqlGenerator,
  OracleGenerator
} from "@/recorder/SqlDialectGenerator.js";

/**
 * Registry-based Factory for SqlDialectGenerator instances.
 */
export class SqlGeneratorFactory {
  private static registry = new Map<string, SqlDialectGenerator>([
    ["postgres", new PostgresGenerator()],
    ["mysql", new MysqlGenerator()],
    ["oracle", new OracleGenerator()]
  ]);

  /**
   * Resolves the appropriate SqlDialectGenerator for a given dialect.
   * Throws an error if the dialect is unsupported.
   */
  public static getGenerator(dialect: string): SqlDialectGenerator {
    const key = dialect.toLowerCase();
    const generator = this.registry.get(key);
    
    if (!generator) {
      throw new Error(`Unsupported SQL dialect: ${dialect}`);
    }
    
    return generator;
  }

  /**
   * Lists all supported SQL dialects.
   */
  public static getSupportedDialects(): string[] {
    return Array.from(this.registry.keys());
  }
}
