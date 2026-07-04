import "reflect-metadata";
import request from "supertest";
import { createGateway, GatewayServer } from "../index";
import { MemoryPersistenceAdapter } from "@polygate/persistence";

describe("Gateway HTTP Integration Tests", () => {
  let gateway: GatewayServer;

  beforeEach(async () => {
    const persistence = new MemoryPersistenceAdapter();
    gateway = createGateway({ persistence, port: 9091 });
  });

  it("should perform management API operations and handle alias proxy routes", async () => {
    // 1. Create App
    const createAppRes = await request(gateway.getApp())
      .post("/api/apps")
      .send({
        appKey: "kite",
        displayName: "Zerodha Kite",
        baseUrl: "https://kite.zerodha.com",
        loginUrl: "https://kite.zerodha.com",
        authType: "NONE",
        status: "ACTIVE"
      });
    
    expect(createAppRes.status).toBe(200);
    expect(createAppRes.body.appKey).toBe("kite");

    // 2. List Apps
    const listAppsRes = await request(gateway.getApp())
      .get("/api/apps");
    
    expect(listAppsRes.status).toBe(200);
    expect(listAppsRes.body.length).toBe(1);

    // 3. Store Session
    const storeSessionRes = await request(gateway.getApp())
      .post("/api/apps/kite/sessions")
      .send({
        cookies: [{ name: "kf_session", value: "abcdef123" }],
        headers: { "Authorization": "token123" }
      });
    
    expect(storeSessionRes.status).toBe(200);
    expect(storeSessionRes.body.status).toBe("success");

    // 3.5. List sessions and check metadata (safe response)
    const listSessionsRes = await request(gateway.getApp())
      .get("/api/apps/kite/sessions");
    
    expect(listSessionsRes.status).toBe(200);
    expect(listSessionsRes.body.length).toBe(1);
    expect(listSessionsRes.body[0].sessionUuid).toBeDefined();
    expect(listSessionsRes.body[0].cookiePayload).toBeUndefined();
    expect(listSessionsRes.body[0].headerPayload).toBeUndefined();

    // 4. Create Endpoint Contract
    const createEndpointRes = await request(gateway.getApp())
      .post("/api/apps/kite/endpoints")
      .send({
        name: "getMargins",
        path: "/oms/user/margins",
        httpMethod: "GET",
        requiresAuth: true
      });
    
    expect(createEndpointRes.status).toBe(200);
    expect(createEndpointRes.body.name).toBe("getMargins");

    // 5. Test Proxy routing with mocked global fetch
    const mockResponse = new Response(JSON.stringify({ status: "success", data: { equity: { available: 500 } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    try {
      const proxyRes = await request(gateway.getApp())
        .get("/apps/kite/oms/user/margins");
      
      expect(proxyRes.status).toBe(200);
      expect(fetchMock).toHaveBeenCalled();
      
      // Verify headers passed to mock fetch contain auth and cookies
      const lastCallArgs = fetchMock.mock.calls[0];
      const targetUrl = lastCallArgs[0];
      const options = lastCallArgs[1];
      
      expect(targetUrl).toBe("https://kite.zerodha.com/oms/user/margins");
      expect(options.headers["authorization"]).toBe("token123");
      expect(options.headers["cookie"]).toBe("kf_session=abcdef123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should route queries via alias route GET /apps?key=appKey", async () => {
    // Register App
    await request(gateway.getApp())
      .post("/api/apps")
      .send({
        appKey: "kite",
        displayName: "Zerodha Kite",
        baseUrl: "https://kite.zerodha.com",
        authType: "NONE",
        status: "ACTIVE"
      });

    const mockResponse = new Response("mock-response", { status: 200 });
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    try {
      const aliasRes = await request(gateway.getApp())
        .get("/apps?key=kite");
      
      expect(aliasRes.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith("https://kite.zerodha.com/", expect.any(Object));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should normalize base URL if configured without a protocol", async () => {
    // 1. Create App with host/ip format (no protocol)
    await request(gateway.getApp())
      .post("/api/apps")
      .send({
        appKey: "no-proto-app",
        displayName: "No Protocol App",
        baseUrl: "localhost:9091/api/v2",
        authType: "NONE",
        status: "ACTIVE"
      });

    const mockResponse = new Response("ok", { status: 200 });
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    try {
      const proxyRes = await request(gateway.getApp())
        .get("/apps/no-proto-app/users/info");
      
      expect(proxyRes.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:9091/api/v2/users/info", expect.any(Object));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should verify an endpoint using stored session cookies and headers via POST /api/apps/:appKey/verify/:name", async () => {
    // 1. Create App
    await request(gateway.getApp())
      .post("/api/apps")
      .send({
        appKey: "secure-app",
        displayName: "Secure App",
        baseUrl: "https://secure.api.com",
        authType: "API_KEY",
        status: "ACTIVE"
      });

    // 2. Store Session
    await request(gateway.getApp())
      .post("/api/apps/secure-app/sessions")
      .send({
        cookies: [{ name: "session_token", value: "cookie-value-999" }],
        headers: { "X-Custom-Header": "header-value-888" }
      });

    // 3. Create Endpoint Definition
    await request(gateway.getApp())
      .post("/api/apps/secure-app/endpoints")
      .send({
        name: "getUserProfile",
        path: "/profile/get",
        httpMethod: "POST",
        requiresAuth: true
      });

    // 4. Mock global fetch
    const mockResponse = new Response(JSON.stringify({ status: "ok", profile: { username: "punit" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = fetchMock;

    try {
      // 5. Call verify API
      const verifyRes = await request(gateway.getApp())
        .post("/api/apps/secure-app/verify/getUserProfile");

      expect(verifyRes.status).toBe(200);
      const parsedBody = JSON.parse(verifyRes.body.body);
      expect(parsedBody.profile.username).toBe("punit");

      // Verify the downstream fetch received injected credentials
      expect(fetchMock).toHaveBeenCalled();
      const lastCallArgs = fetchMock.mock.calls[0];
      const targetUrl = lastCallArgs[0];
      const options = lastCallArgs[1];

      expect(targetUrl).toBe("https://secure.api.com/profile/get");
      expect(options.headers["x-custom-header"]).toBe("header-value-888");
      expect(options.headers["cookie"]).toBe("session_token=cookie-value-999");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
