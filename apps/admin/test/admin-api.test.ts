import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdminServer } from "../src/app.js";

describe("admin api", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    servers.length = 0;
    dirs.length = 0;
  });

  it("requires a client token to read gateway config", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
    });

    expect(response.statusCode).toBe(401);
  });

  it("lets an admin save config and a gateway fetch it", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
    });
    servers.push(server);

    const login = await server.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { username: "admin", password: "secret" },
    });
    expect(login.statusCode).toBe(200);
    const { token } = login.json<{ token: string }>();

    const save = await server.inject({
      method: "PUT",
      url: "/api/admin/config",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        pollIntervalSeconds: 15,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "gpt-5.5-compatible",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      },
    });
    expect(save.statusCode).toBe(200);

    const gateway = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: "Bearer client-token" },
    });

    expect(gateway.statusCode).toBe(200);
    expect(gateway.json().providers[0].apiKey).toBe("sk-test");
  });

  it("filters gateway config routes by client token model permissions", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "legacy-client-token",
      initialConfig: {
        version: 1,
        pollIntervalSeconds: 60,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: "https://primary.example.com/v1",
            apiKey: "sk-primary",
            enabled: true,
          },
          {
            id: "backup",
            name: "Backup",
            baseUrl: "https://backup.example.com/v1",
            apiKey: "sk-backup",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "primary-route",
            providerId: "primary",
            matchModel: "codex-best",
            upstreamModel: "primary-model",
            enabled: true,
            priority: 100,
          },
          {
            id: "backup-route",
            providerId: "backup",
            matchModel: "codex-best",
            upstreamModel: "backup-model",
            enabled: true,
            priority: 10,
          },
        ],
        defaultRouteId: "backup-route",
      },
    });
    servers.push(server);
    const adminToken = await login(server);

    const created = await server.inject({
      method: "POST",
      url: "/api/admin/tokens",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Limited laptop" },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json<{ token: { id: string }; tokenValue: string }>();

    const defaultConfig = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: `Bearer ${createdBody.tokenValue}` },
    });
    expect(defaultConfig.statusCode).toBe(200);
    expect(defaultConfig.json().routes.map((route: { id: string }) => route.id)).toEqual([
      "primary-route",
      "backup-route",
    ]);

    const patched = await server.inject({
      method: "PATCH",
      url: `/api/admin/tokens/${createdBody.token.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { allowedRouteIds: ["primary-route"] },
    });
    expect(patched.statusCode).toBe(200);

    const limitedConfig = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: `Bearer ${createdBody.tokenValue}` },
    });

    expect(limitedConfig.statusCode).toBe(200);
    expect(limitedConfig.json().routes.map((route: { id: string }) => route.id)).toEqual([
      "primary-route",
    ]);
    expect(limitedConfig.json().providers.map((provider: { id: string }) => provider.id)).toEqual([
      "primary",
    ]);
    expect(limitedConfig.json().defaultRouteId).toBe("primary-route");
  });

  it("lets an admin create, disable, enable, and delete client tokens", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "legacy-client-token",
    });
    servers.push(server);
    const token = await login(server);

    const created = await server.inject({
      method: "POST",
      url: "/api/admin/tokens",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Alice laptop", note: "friend" },
    });

    expect(created.statusCode).toBe(200);
    const createdBody = created.json<{ token: { id: string }; tokenValue: string }>();
    expect(createdBody.tokenValue).toMatch(/^clt_/);
    expect(createdBody.token.id).toBeTruthy();
    expect(createdBody.token.tokenValue).toBe(createdBody.tokenValue);

    const listed = await server.inject({
      method: "GET",
      url: "/api/admin/tokens",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().tokens[0].tokenValue).toBe(createdBody.tokenValue);

    const configOk = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: `Bearer ${createdBody.tokenValue}` },
    });
    expect(configOk.statusCode).toBe(200);

    const disabled = await server.inject({
      method: "PATCH",
      url: `/api/admin/tokens/${createdBody.token.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);

    const configDisabled = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: `Bearer ${createdBody.tokenValue}` },
    });
    expect(configDisabled.statusCode).toBe(403);
    expect(configDisabled.json().error).toBe("token disabled");

    const enabled = await server.inject({
      method: "PATCH",
      url: `/api/admin/tokens/${createdBody.token.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);

    const removed = await server.inject({
      method: "DELETE",
      url: `/api/admin/tokens/${createdBody.token.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    expect(removed.statusCode).toBe(200);

    const configDeleted = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: `Bearer ${createdBody.tokenValue}` },
    });
    expect(configDeleted.statusCode).toBe(403);
  });

  it("aggregates periodic usage reports by client token", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "legacy-client-token",
    });
    servers.push(server);
    const adminToken = await login(server);
    const created = await server.inject({
      method: "POST",
      url: "/api/admin/tokens",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Usage token" },
    });
    const { tokenValue } = created.json<{ tokenValue: string }>();

    const report = await server.inject({
      method: "POST",
      url: "/api/gateway/usage",
      headers: { authorization: `Bearer ${tokenValue}` },
      payload: {
        inputTokens: 100,
        outputTokens: 40,
        cachedInputTokens: 25,
        totalTokens: 140,
        requestCount: 3,
        successCount: 2,
        failureCount: 1,
      },
    });
    expect(report.statusCode).toBe(200);

    const dashboard = await server.inject({
      method: "GET",
      url: "/api/admin/dashboard",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().totals.totalTokens).toBe(140);
    expect(dashboard.json().tokens[0].tokenValue).toBe(tokenValue);
    expect(dashboard.json().tokens[0].totalTokens).toBe(140);
    expect(dashboard.json().tokens[0].requestCount).toBe(3);
  });

  it("lets an admin upload a Codex 桌面版 installer and a gateway download it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-admin-"));
    dirs.push(dir);
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
      dataPath: join(dir, "config.json"),
    });
    servers.push(server);
    const adminToken = await login(server);

    const missing = await server.inject({
      method: "GET",
      url: "/api/gateway/codex-desktop-installer",
      headers: { authorization: "Bearer client-token" },
    });
    expect(missing.statusCode).toBe(404);

    const upload = await server.inject({
      method: "PUT",
      url: "/api/admin/codex-desktop-installer",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/octet-stream",
        "x-file-name": "CodexSetup.msixbundle",
      },
      payload: Buffer.from("fake-installer"),
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().installer.fileName).toBe("CodexSetup.msixbundle");

    const status = await server.inject({
      method: "GET",
      url: "/api/admin/codex-desktop-installer",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().uploaded).toBe(true);
    expect(status.json().size).toBe("fake-installer".length);

    const download = await server.inject({
      method: "GET",
      url: "/api/gateway/codex-desktop-installer",
      headers: { authorization: "Bearer client-token" },
    });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe("fake-installer");
  });

  it("lets an admin delete a legacy Codex 桌面版 installer GitHub URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-admin-"));
    dirs.push(dir);
    const installerDir = join(dir, "installers");
    await mkdir(installerDir, { recursive: true });
    await writeFile(
      join(installerDir, "codex-desktop-installer.json"),
      JSON.stringify({
        fileName: "CodexSetup.msixbundle",
        size: 0,
        updatedAt: new Date().toISOString(),
        downloadUrl: "https://github.com/example/codex/releases/download/v1/CodexSetup.msixbundle",
      }),
      "utf8",
    );

    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
      dataPath: join(dir, "config.json"),
    });
    servers.push(server);
    const adminToken = await login(server);

    const before = await server.inject({
      method: "GET",
      url: "/api/admin/codex-desktop-installer",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().hasUrl).toBe(true);

    const removeUrl = await server.inject({
      method: "DELETE",
      url: "/api/admin/codex-desktop-installer?source=url",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(removeUrl.statusCode).toBe(200);

    const after = await server.inject({
      method: "GET",
      url: "/api/admin/codex-desktop-installer",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ uploaded: false, hasUrl: false });
  });

  it("lets an admin upload a client release and a gateway download it with version metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-admin-"));
    dirs.push(dir);
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
      dataPath: join(dir, "config.json"),
    });
    servers.push(server);
    const adminToken = await login(server);

    const missingVersion = await server.inject({
      method: "PUT",
      url: "/api/admin/client-release",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/octet-stream",
        "x-file-name": "Codex Login Tools .NET.exe",
      },
      payload: Buffer.from("fake-client"),
    });
    expect(missingVersion.statusCode).toBe(400);

    const upload = await server.inject({
      method: "PUT",
      url: "/api/admin/client-release",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/octet-stream",
        "x-file-name": "Codex Login Tools .NET.exe",
        "x-version": "0.2.0",
      },
      payload: Buffer.from("fake-client"),
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().release.version).toBe("0.2.0");

    const status = await server.inject({
      method: "GET",
      url: "/api/gateway/client-release",
      headers: { authorization: "Bearer client-token" },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().uploaded).toBe(true);
    expect(status.json().version).toBe("0.2.0");

    const download = await server.inject({
      method: "GET",
      url: "/api/gateway/client-release/download",
      headers: { authorization: "Bearer client-token" },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["x-version"]).toBe("0.2.0");
    expect(download.body).toBe("fake-client");
  });

  it("persists saved config to disk for server restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-admin-"));
    dirs.push(dir);
    const dataPath = join(dir, "config.json");
    const options = {
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
      dataPath,
    };
    const firstServer = buildAdminServer(options);
    servers.push(firstServer);

    const login = await firstServer.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { username: "admin", password: "secret" },
    });
    const { token } = login.json<{ token: string }>();

    await firstServer.inject({
      method: "PUT",
      url: "/api/admin/config",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        pollIntervalSeconds: 15,
        providers: [
          {
            id: "persisted",
            name: "Persisted",
            baseUrl: "https://persisted.example.com/v1",
            apiKey: "sk-persisted",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "persisted",
            matchModel: "*",
            upstreamModel: "persisted-model",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      },
    });
    await firstServer.close();
    servers.pop();

    const secondServer = buildAdminServer(options);
    servers.push(secondServer);
    const gateway = await secondServer.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: "Bearer client-token" },
    });

    expect(gateway.json().providers[0].id).toBe("persisted");
  });

  it("keeps an existing provider api key when an admin saves a redacted key", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
      initialConfig: {
        version: 1,
        pollIntervalSeconds: 60,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-original",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "model-a",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      },
    });
    servers.push(server);

    const login = await server.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { username: "admin", password: "secret" },
    });
    const { token } = login.json<{ token: string }>();

    const save = await server.inject({
      method: "PUT",
      url: "/api/admin/config",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        pollIntervalSeconds: 60,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: "https://new.example.com/v1",
            apiKey: "********",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "model-b",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      },
    });

    expect(save.statusCode).toBe(200);

    const gateway = await server.inject({
      method: "GET",
      url: "/api/gateway/config",
      headers: { authorization: "Bearer client-token" },
    });

    expect(gateway.json().providers[0].apiKey).toBe("sk-original");
    expect(gateway.json().providers[0].baseUrl).toBe("https://new.example.com/v1");
  });

  it("enforces per-token device limit and supports unbinding", async () => {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "legacy-client-token",
    });
    servers.push(server);
    const adminToken = await login(server);

    const save = await server.inject({
      method: "PUT",
      url: "/api/admin/config",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 1,
        pollIntervalSeconds: 60,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "gpt-5.5-compatible",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      },
    });
    expect(save.statusCode).toBe(200);

    const created = await server.inject({
      method: "POST",
      url: "/api/admin/tokens",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "device-limited" },
    });
    const { token, tokenValue } = created.json<{ token: { id: string }; tokenValue: string }>();

    const setLimit = await server.inject({
      method: "PATCH",
      url: `/api/admin/tokens/${token.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { deviceLimit: 2 },
    });
    expect(setLimit.statusCode).toBe(200);

    const pull = (deviceId: string) =>
      server.inject({
        method: "GET",
        url: "/api/gateway/config",
        headers: { authorization: `Bearer ${tokenValue}`, "x-device-id": deviceId },
      });

    expect((await pull("device-a")).statusCode).toBe(200);
    expect((await pull("device-b")).statusCode).toBe(200);

    const third = await pull("device-c");
    expect(third.statusCode).toBe(403);
    expect(third.json().error).toBe("device limit reached");

    // Already-bound device still works even when at the limit.
    expect((await pull("device-a")).statusCode).toBe(200);

    const unbind = await server.inject({
      method: "DELETE",
      url: `/api/admin/tokens/${token.id}/devices/device-a`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(unbind.statusCode).toBe(200);

    // Freed a seat, so the new device can bind now.
    expect((await pull("device-c")).statusCode).toBe(200);

    const listed = await server.inject({
      method: "GET",
      url: "/api/admin/tokens",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const listedToken = listed
      .json<{ tokens: Array<{ id: string; boundDevices: Array<{ deviceId: string }> }> }>()
      .tokens.find((item) => item.id === token.id);
    const boundIds = (listedToken?.boundDevices ?? []).map((device) => device.deviceId).sort();
    expect(boundIds).toEqual(["device-b", "device-c"]);
  });
});

async function login(server: ReturnType<typeof buildAdminServer>): Promise<string> {
  const loginResponse = await server.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { username: "admin", password: "secret" },
  });
  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json<{ token: string }>().token;
}
