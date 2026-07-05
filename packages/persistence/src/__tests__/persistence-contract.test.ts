import "reflect-metadata";
import path from "path";
import fs from "fs";
import { MemoryPersistenceAdapter, YamlPersistenceAdapter } from "../index.js";
import { YamlHelper } from "../yaml/YamlRepositories.js";
import { Application, EndpointDefinition } from "@polygate/core";

const initialSeedDir = YamlHelper.getSeedDir();

function runRepositoryContractTests(
  adapterName: string,
  setupAdapter: () => Promise<any>,
  cleanupAdapter?: (adapter: any) => Promise<void>
) {
  describe(`Contract Tests: ${adapterName}`, () => {
    let adapter: any;

    beforeEach(async () => {
      adapter = await setupAdapter();
    });

    afterEach(async () => {
      if (cleanupAdapter) {
        await cleanupAdapter(adapter);
      }
    });

    describe("AppRepository", () => {
      it("should upsert and find applications by key", async () => {
        const app: Application = {
          appKey: "copilot",
          displayName: "GitHub Copilot",
          baseUrl: "https://github.com/copilot",
          authType: "OAUTH",
          status: "ACTIVE",
          sessionCaptureHeaders: "x-custom-*,authorization"
        };

        const saved = await adapter.appRepository.upsert(app);
        expect(saved.id).toBeDefined();
        expect(saved.appKey).toBe("copilot");
        expect(saved.sessionCaptureHeaders).toBe("x-custom-*,authorization");

        const found = await adapter.appRepository.findByKey("copilot");
        expect(found).not.toBeNull();
        expect(found?.displayName).toBe("GitHub Copilot");
        expect(found?.sessionCaptureHeaders).toBe("x-custom-*,authorization");

        const list = await adapter.appRepository.list();
        expect(list.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("SessionRepository", () => {
      it("should save, retrieve active and invalidate sessions", async () => {
        // First upsert an app
        const app = await adapter.appRepository.upsert({
          appKey: "kite",
          displayName: "Zerodha Kite",
          baseUrl: "https://kite.zerodha.com",
          authType: "NONE",
          status: "ACTIVE"
        });

        const session = {
          appId: app.id!,
          cookiePayload: "encrypted-cookies-payload",
          headerPayload: "encrypted-headers-payload",
          isActive: true
        };

        await adapter.sessionRepository.saveSession(app.id!, session);

        const active = await adapter.sessionRepository.getActiveSession(app.id!);
        expect(active).not.toBeNull();
        expect(active?.cookiePayload).toBe("encrypted-cookies-payload");

        // Save a second session that we will invalidate
        const session2 = {
          appId: app.id!,
          cookiePayload: "encrypted-cookies-payload-2",
          headerPayload: "encrypted-headers-payload-2",
          isActive: true
        };
        await adapter.sessionRepository.saveSession(app.id!, session2);
        
        const listBefore = await adapter.sessionRepository.listSessions(app.id!);
        expect(listBefore.length).toBe(2);

        // Invalidate the second session (making it inactive)
        const active2 = await adapter.sessionRepository.getActiveSession(app.id!); // returns the latest active session
        expect(active2?.cookiePayload).toBe("encrypted-cookies-payload-2");
        if (active2 && active2.id) {
          await adapter.sessionRepository.invalidate(active2.id);
        }

        // Clean up/clear inactive sessions
        await adapter.sessionRepository.deleteInactiveSessions(app.id!);

        const listAfter = await adapter.sessionRepository.listSessions(app.id!);
        expect(listAfter.length).toBe(1);
        expect(listAfter[0].cookiePayload).toBe("encrypted-cookies-payload"); // The active one remains!
        expect(listAfter[0].isActive).toBe(true);
      });
    });

    describe("EndpointRepository", () => {
      it("should upsert and retrieve endpoints", async () => {
        const app = await adapter.appRepository.upsert({
          appKey: "testapp",
          displayName: "Test App",
          baseUrl: "https://example.com",
          authType: "NONE",
          status: "ACTIVE"
        });

        const endpoint: EndpointDefinition = {
          appId: app.id!,
          name: "getMargins",
          path: "/margins",
          httpMethod: "GET",
          requiresAuth: true,
          requestHeaders: { "Content-Type": "application/json" }
        };

        const saved = await adapter.endpointRepository.upsert(endpoint);
        expect(saved.id).toBeDefined();
        expect(saved.name).toBe("getMargins");

        const list = await adapter.endpointRepository.list(app.id!);
        expect(list.length).toBe(1);
        expect(list[0].path).toBe("/margins");

        const found = await adapter.endpointRepository.findByName(app.id!, "getMargins");
        expect(found).not.toBeNull();
      });
    });

    describe("AuditLogRepository", () => {
      it("should save audit logs", async () => {
        const log = {
          action: "SEED" as const,
          statusCode: 200,
          detail: "Successfully seeded databases"
        };

        const saved = await adapter.auditLogRepository.save(log);
        expect(saved.executedAt).toBeDefined();
      });
    });
  });
}

// 1. Run for Memory
runRepositoryContractTests("Memory Persistence Adapter", async () => {
  return new MemoryPersistenceAdapter();
});

// 2. Run for YAML (using a temporary directory to keep tests clean)
const tempSeedDir = path.join(process.cwd(), "seed-data-test");
runRepositoryContractTests(
  "YAML Persistence Adapter",
  async () => {
    YamlHelper.setSeedDir(tempSeedDir);
    YamlHelper.ensureDirectories();
    return new YamlPersistenceAdapter();
  },
  async () => {
    // Cleanup temporary directory
    if (fs.existsSync(tempSeedDir)) {
      fs.rmSync(tempSeedDir, { recursive: true, force: true });
    }
  }
);

describe("YamlHelper seedDir auto-resolution", () => {
  it("should auto-resolve to the workspace root seed-data directory", () => {
    expect(initialSeedDir).toBeDefined();
    expect(fs.existsSync(initialSeedDir)).toBe(true);
    expect(path.basename(initialSeedDir)).toBe("seed-data");
  });
});

import { PersistenceAdapterFactory } from "../index.js";

describe("PersistenceAdapterFactory", () => {
  it("should create memory adapter and not throw", async () => {
    const adapter = await PersistenceAdapterFactory.create("memory");
    expect(adapter).toBeDefined();
    expect(adapter.appRepository).toBeDefined();
  });

  it("should fallback to memory adapter for unrecognized persistence driver", async () => {
    const adapter = await PersistenceAdapterFactory.create("invalid-driver");
    expect(adapter).toBeDefined();
    expect(adapter.appRepository).toBeDefined();
  });
});
