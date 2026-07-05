import fs from "fs";
import yaml from "js-yaml";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validation engine for generated YAML and SQL files.
 */
export class Validator {
  /**
   * Validates if a file is well-formed YAML.
   */
  public static validateYaml(filePath: string): ValidationResult {
    const errors: string[] = [];
    try {
      if (!fs.existsSync(filePath)) {
        errors.push(`File does not exist: ${filePath}`);
        return { isValid: false, errors };
      }

      const content = fs.readFileSync(filePath, "utf8");
      yaml.load(content);
    } catch (err: any) {
      errors.push(`YAML Syntax Error: ${err.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validates generated SQL files (structural checks: balanced quotes and parentheses).
   */
  public static validateSql(filePath: string): ValidationResult {
    const errors: string[] = [];
    try {
      if (!fs.existsSync(filePath)) {
        errors.push(`File does not exist: ${filePath}`);
        return { isValid: false, errors };
      }

      const content = fs.readFileSync(filePath, "utf8");
      
      // Simple parser rules for basic structural validation
      let inSingleQuote = false;
      let openParentheses = 0;
      let lineNumber = 1;

      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        
        if (char === "\n") {
          lineNumber++;
        }

        // Handle quote toggle (escaped quotes are represented as '')
        if (char === "'") {
          // Check if next char is also a quote (escaped quote)
          if (i + 1 < content.length && content[i + 1] === "'") {
            i++; // skip escaped quote
          } else {
            inSingleQuote = !inSingleQuote;
          }
        }

        if (!inSingleQuote) {
          if (char === "(") openParentheses++;
          if (char === ")") {
            openParentheses--;
            if (openParentheses < 0) {
              errors.push(`Unmatched closing parenthesis ')' at line ${lineNumber}`);
              openParentheses = 0; // reset to avoid compounding
            }
          }
        }
      }

      if (inSingleQuote) {
        errors.push("Unterminated string literal (missing single quote) at end of file.");
      }
      if (openParentheses > 0) {
        errors.push(`Unmatched opening parenthesis '(' (count: ${openParentheses}) remaining at end of file.`);
      }

    } catch (err: any) {
      errors.push(`SQL Validation system error: ${err.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validates if a file is a structurally valid OpenAPI Spec.
   */
  public static validateOpenApi(filePath: string): ValidationResult {
    const errors: string[] = [];
    try {
      if (!fs.existsSync(filePath)) {
        errors.push(`File does not exist: ${filePath}`);
        return { isValid: false, errors };
      }

      const content = fs.readFileSync(filePath, "utf8");
      const doc = yaml.load(content) as any;

      if (!doc) {
        errors.push("OpenAPI Spec is empty or not well-formed YAML");
        return { isValid: false, errors };
      }

      if (!doc.openapi) {
        errors.push("Missing required 'openapi' version field");
      }
      if (!doc.info || !doc.info.title || !doc.info.version) {
        errors.push("Missing required 'info' fields (title, version)");
      }
      if (!doc.paths || typeof doc.paths !== "object") {
        errors.push("Missing required 'paths' object");
      }
      if (!doc["x-polygate-app-key"]) {
        errors.push("Missing required custom extension 'x-polygate-app-key'");
      }

    } catch (err: any) {
      errors.push(`OpenAPI Validation Syntax Error: ${err.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
