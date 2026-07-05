import { program } from "@/index.js";
import { chromium } from "playwright";

jest.mock("playwright", () => {
  const mockPage = {
    on: jest.fn(),
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue("https://kite.zerodha.com/dashboard"),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    cookies: jest.fn().mockResolvedValue([
      { name: "kf_session", value: "mock-session-val" }
    ])
  };
  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined)
  };
  return {
    chromium: {
      launch: jest.fn().mockResolvedValue(mockBrowser)
    }
  };
});

describe("CLI Login Command Tests", () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("should successfully run login capture command and save credentials", async () => {
    const mockAppsList = [
      {
        appKey: "kite",
        loginUrl: "https://kite.zerodha.com",
        loginSuccessUrlPattern: "kite.zerodha.com/dashboard",
        loginSuccessCookieName: "kf_session"
      }
    ];

    const mockFetch = jest.fn().mockImplementation((url: string, init?: any) => {
      if (url.endsWith("/api/apps")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockAppsList)
        });
      }
      if (url.includes("/sessions")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve("success")
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    global.fetch = mockFetch as any;

    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code?: any) => {
      throw new Error(`process.exit called with: ${code}`);
    });

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      await program.parseAsync(["node", "polygate", "login", "-a", "kite"]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, "http://localhost:8080/api/apps");
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://localhost:8080/api/apps/kite/sessions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("mock-session-val")
        })
      );
      
      expect(consoleSpy).toHaveBeenCalledWith("Success login signal detected!");
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("should fail login capture if loginSuccessUrlPattern and loginSuccessCookieName are both missing", async () => {
    const mockAppsList = [
      {
        appKey: "kite",
        loginUrl: "https://kite.zerodha.com"
      }
    ];

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/apps")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockAppsList)
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    global.fetch = mockFetch as any;

    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code?: any) => {
      throw new Error(`process.exit called with: ${code}`);
    });

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        program.parseAsync(["node", "polygate", "login", "-a", "kite"])
      ).rejects.toThrow("process.exit called with: 1");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Application config must define loginSuccessUrlPattern or loginSuccessCookieName in YAML/SQL to detect login completion."
      );
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
