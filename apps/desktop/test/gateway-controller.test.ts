import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { GatewayController } from "../src/main/gateway-controller.js";
import { defaultDesktopSettings } from "../src/main/settings-store.js";

describe("GatewayController", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.map((item) => item()));
    cleanup.length = 0;
  });

  it("starts and stops the local gateway", async () => {
    const configServer = buildConfigServer();
    cleanup.push(() => configServer.close());
    await configServer.listen({ host: "127.0.0.1", port: 0 });

    const controller = new GatewayController({
      getSettings: () => ({
        ...defaultDesktopSettings,
        configUrl: `http://127.0.0.1:${configServer.server.address().port}`,
        clientToken: "friend-token",
        gatewayPort: 0,
      }),
      getCodexConfigPath: () => join(tmpdir(), "unused-config.toml"),
    });
    cleanup.push(() => controller.stop());

    await controller.start();
    expect(controller.getStatus()).toMatchObject({
      running: true,
      hasConfig: true,
    });

    await controller.stop();
    expect(controller.getStatus().running).toBe(false);
  });

  it("writes Codex config using the current settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-desktop-controller-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const configPath = join(dir, "config.toml");

    const controller = new GatewayController({
      getSettings: () => ({
        ...defaultDesktopSettings,
        gatewayPort: 19002,
        providerId: "desktop_gateway",
        model: "codex-best",
      }),
      getCodexConfigPath: () => configPath,
    });

    await controller.writeCodexConfig();

    const content = await readFile(configPath, "utf8");
    expect(content).toContain('model_provider = "desktop_gateway"');
    expect(content).toContain('model = "codex-best"');
    expect(content).toContain('base_url = "http://127.0.0.1:19002/v1"');
  });
});

function buildConfigServer() {
  const server = Fastify({ logger: false });
  server.get("/api/gateway/config", async () => ({
    version: 1,
    pollIntervalSeconds: 10,
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
        upstreamModel: "upstream-model",
        enabled: true,
        priority: 100,
      },
    ],
    defaultRouteId: "default",
  }));
  return server;
}
