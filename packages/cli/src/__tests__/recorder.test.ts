import fs from "fs";
import path from "path";
import { SchemaGenerator } from "@/recorder/SchemaGenerator.js";
import { SqlGeneratorFactory } from "@/recorder/SqlGeneratorFactory.js";
import { SeedToSqlConverter } from "@/recorder/SeedToSqlConverter.js";
import { Validator } from "@/recorder/Validator.js";
import { PlaywrightRecorder } from "@/recorder/PlaywrightRecorder.js";

describe("Playwright Recorder & SQL Generator Subsystem Tests", () => {
  
  describe("SchemaGenerator Unit Tests", () => {
    it("should infer schema for null", () => {
      const result = SchemaGenerator.infer(null);
      expect(result).toEqual({ type: "null" });
    });

    it("should infer schema for basic primitives", () => {
      expect(SchemaGenerator.infer("hello")).toEqual({ type: "string" });
      expect(SchemaGenerator.infer(123)).toEqual({ type: "integer" });
      expect(SchemaGenerator.infer(12.34)).toEqual({ type: "number" });
      expect(SchemaGenerator.infer(true)).toEqual({ type: "boolean" });
    });

    it("should infer schema for arrays", () => {
      const result = SchemaGenerator.infer(["test", "value"]);
      expect(result).toEqual({
        type: "array",
        items: { type: "string" }
      });
    });

    it("should infer schema for complex objects", () => {
      const payload = {
        name: "PolyGate",
        active: true,
        count: 5,
        items: [1, 2, 3]
      };
      const result = SchemaGenerator.infer(payload);
      expect(result).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          active: { type: "boolean" },
          count: { type: "integer" },
          items: {
            type: "array",
            items: { type: "integer" }
          }
        },
        required: ["name", "active", "count", "items"]
      });
    });
  });

  describe("SqlGeneratorFactory Unit Tests", () => {
    it("should resolve correct strategies for each dialect", () => {
      const pg = SqlGeneratorFactory.getGenerator("postgres");
      expect(pg.getDialectName()).toBe("postgres");

      const mysql = SqlGeneratorFactory.getGenerator("mysql");
      expect(mysql.getDialectName()).toBe("mysql");

      const oracle = SqlGeneratorFactory.getGenerator("oracle");
      expect(oracle.getDialectName()).toBe("oracle");
    });

    it("should throw error for unsupported dialects", () => {
      expect(() => SqlGeneratorFactory.getGenerator("invalid-db")).toThrow(
        "Unsupported SQL dialect: invalid-db"
      );
    });
  });

  describe("Validator Unit Tests", () => {
    it("should validate well-formed YAML files", () => {
      const tempYaml = path.join(__dirname, "temp-test.yaml");
      fs.mkdirSync(path.dirname(tempYaml), { recursive: true });
      fs.writeFileSync(tempYaml, "test:\n  value: 123", "utf8");

      const result = Validator.validateYaml(tempYaml);
      expect(result.isValid).toBe(true);

      fs.unlinkSync(tempYaml);
    });

    it("should catch invalid SQL with unmatched parenthesis", () => {
      const tempSql = path.join(__dirname, "temp-test.sql");
      fs.mkdirSync(path.dirname(tempSql), { recursive: true });
      fs.writeFileSync(tempSql, "INSERT INTO TEST (ID VALUES (1);", "utf8"); // missing closing paren

      const result = Validator.validateSql(tempSql);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      fs.unlinkSync(tempSql);
    });
  });

  describe("SeedToSqlConverter Functional Tests", () => {
    const testSeedDir = path.join(__dirname, "mock-seed-data");

    beforeAll(() => {
      // Set up mock seed data
      fs.mkdirSync(path.join(testSeedDir, "apps"), { recursive: true });
      fs.mkdirSync(path.join(testSeedDir, "endpoints", "testapp"), { recursive: true });

      // Mock App YAML
      fs.writeFileSync(
        path.join(testSeedDir, "apps", "testapp.yaml"),
        `app:
  key: testapp
  displayName: Test Application
  baseUrl: http://localhost:3000
  authType: NONE
  status: ACTIVE`,
        "utf8"
      );

      // Mock Endpoint YAML
      fs.writeFileSync(
        path.join(testSeedDir, "endpoints", "testapp", "get-status.yaml"),
        `endpoint:
  app: testapp
  name: getStatus
  path: /status
  method: GET
  requiresAuth: false
  description: Returns api health`,
        "utf8"
      );
    });

    afterAll(() => {
      // Clean up mock seed data
      fs.rmSync(testSeedDir, { recursive: true, force: true });
    });

    it("should compile YAML seeds to Postgres DML scripts successfully", async () => {
      const pgSqlPath = await SeedToSqlConverter.convertAndSave("testapp", "postgres", testSeedDir);
      expect(fs.existsSync(pgSqlPath)).toBe(true);

      const content = fs.readFileSync(pgSqlPath, "utf8");
      expect(content).toContain("INSERT INTO PG_APPLICATION");
      expect(content).toContain("INSERT INTO PG_ENDPOINT_DEFINITION");
      expect(content).toContain("'testapp'");
      expect(content).toContain("'/status'");

      const validation = Validator.validateSql(pgSqlPath);
      expect(validation.isValid).toBe(true);

      fs.unlinkSync(pgSqlPath);
    });
  });

  describe("PlaywrightRecorder Unit Tests", () => {
    it("should redact session capture headers to 'required'", async () => {
      const tempSeedDir = path.join(__dirname, "temp-recorder-seed");
      fs.mkdirSync(path.join(tempSeedDir, "apps"), { recursive: true });
      fs.writeFileSync(
        path.join(tempSeedDir, "apps", "testapp.yaml"),
        `app:
  appKey: testapp
  displayName: Test App
  baseUrl: http://localhost:3000
  sessionCaptureHeaders: authorization,x-session-id`,
        "utf8"
      );

      const recorder = new PlaywrightRecorder("testapp", "http://localhost:3000");
      process.env.SEED_DIR = tempSeedDir;

      const mockRequest = {
        resourceType: () => "fetch",
        method: () => "POST",
        headers: () => ({
          "authorization": "Bearer token123",
          "x-session-id": "sess-456",
          "x-static-header": "static-789",
          "content-type": "application/json"
        }),
        postData: () => null
      };

      const mockResponse = {
        url: () => "http://localhost:3000/api/users",
        request: () => mockRequest,
        status: () => 200,
        json: () => Promise.resolve({ success: true })
      };

      const mockPage = {};

      await (recorder as any).handleResponse(mockResponse, mockPage);

      const ep = (recorder as any).endpoints.get("post_api_users");
      expect(ep).toBeDefined();
      expect(ep.requestHeaders).toEqual({
        "authorization": "required",
        "x-session-id": "required",
        "content-type": "application/json"
      });

      fs.rmSync(tempSeedDir, { recursive: true, force: true });
      delete process.env.SEED_DIR;
    });
  });
});
