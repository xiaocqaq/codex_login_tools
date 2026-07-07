import { buildGatewayServer, type GatewayServer } from "@codex-login-tools/gateway/app";
import { writeCodexGatewayConfig } from "@codex-login-tools/gateway/codex-config";
import type { AddressInfo } from "node:net";
import type { DesktopSettings } from "./settings-store.js";

export interface GatewayControllerOptions {
  getSettings: () => DesktopSettings;
  getCodexConfigPath: () => string;
}

export interface GatewayStatus {
  running: boolean;
  hasConfig: boolean;
  lastConfigRefreshAt?: string;
  listenUrl?: string;
  error?: string;
}

export class GatewayController {
  private server: GatewayServer | undefined;
  private status: GatewayStatus = { running: false, hasConfig: false };

  constructor(private readonly options: GatewayControllerOptions) {}

  async start(): Promise<GatewayStatus> {
    if (this.server) {
      return this.getStatus();
    }

    const settings = this.options.getSettings();
    const configUrl = resolveGatewayConfigUrl(settings.configUrl);
    const server = buildGatewayServer({
      configUrl,
      usageUrl: resolveGatewayUsageUrl(configUrl),
      clientToken: settings.clientToken,
    });

    try {
      await server.refreshConfig();
      await server.listen({ host: settings.gatewayHost, port: settings.gatewayPort });
      this.server = server;
      this.status = {
        running: true,
        hasConfig: Boolean(server.getCurrentConfig()),
        listenUrl: this.resolveListenUrl(server, settings.gatewayHost),
      };
    } catch (error) {
      await server.close().catch(() => undefined);
      this.status = {
        running: false,
        hasConfig: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return this.getStatus();
  }

  async stop(): Promise<GatewayStatus> {
    if (this.server) {
      await this.server.close();
      this.server = undefined;
    }

    this.status = { ...this.status, running: false, listenUrl: undefined };
    return this.getStatus();
  }

  async refreshConfig(): Promise<GatewayStatus> {
    if (!this.server) {
      return this.start();
    }

    try {
      await this.server.refreshConfig();
      this.status = {
        ...this.status,
        hasConfig: Boolean(this.server.getCurrentConfig()),
        error: undefined,
      };
    } catch (error) {
      this.status = {
        ...this.status,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return this.getStatus();
  }

  async writeCodexConfig(): Promise<void> {
    const settings = this.options.getSettings();
    await writeCodexGatewayConfig({
      configPath: this.options.getCodexConfigPath(),
      port: settings.gatewayPort,
      providerId: settings.providerId,
      model: settings.model,
    });
  }

  async flushUsage(): Promise<void> {
    await this.server?.flushUsage();
  }

  getStatus(): GatewayStatus {
    return { ...this.status };
  }

  private resolveListenUrl(server: GatewayServer, fallbackHost: string): string {
    const address = server.server.address() as AddressInfo | null;
    const port = address?.port ?? this.options.getSettings().gatewayPort;
    return `http://${fallbackHost}:${port}`;
  }
}

function resolveGatewayConfigUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  return trimmed.endsWith("/api/gateway/config")
    ? trimmed
    : `${trimmed}/api/gateway/config`;
}

function resolveGatewayUsageUrl(configUrl: string): string {
  return configUrl.replace(/\/config$/, "/usage");
}
