import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DesktopSettings {
  configUrl: string;
  clientToken: string;
  gatewayHost: string;
  gatewayPort: number;
  model: string;
  providerId: string;
  startOnLaunch: boolean;
  writeCodexConfigOnStart: boolean;
}

export const defaultDesktopSettings: DesktopSettings = {
  configUrl: "https://admin.xlingo.fun",
  clientToken: "",
  gatewayHost: "127.0.0.1",
  gatewayPort: 17861,
  model: "codex-best",
  providerId: "friend_gateway",
  startOnLaunch: false,
  writeCodexConfigOnStart: true,
};

export async function loadDesktopSettings(path: string): Promise<DesktopSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return normalizeDesktopSettings(parsed);
  } catch {
    return defaultDesktopSettings;
  }
}

export async function saveDesktopSettings(
  path: string,
  settings: DesktopSettings,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const normalized = normalizeDesktopSettings(settings);
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

function normalizeDesktopSettings(input: unknown): DesktopSettings {
  if (!input || typeof input !== "object") {
    return defaultDesktopSettings;
  }

  const source = input as Partial<Record<keyof DesktopSettings, unknown>>;
  return {
    configUrl: stringOrDefault(source.configUrl, defaultDesktopSettings.configUrl),
    clientToken: stringOrDefault(source.clientToken, defaultDesktopSettings.clientToken),
    gatewayHost: stringOrDefault(source.gatewayHost, defaultDesktopSettings.gatewayHost),
    gatewayPort: portOrDefault(source.gatewayPort, defaultDesktopSettings.gatewayPort),
    model: stringOrDefault(source.model, defaultDesktopSettings.model),
    providerId: stringOrDefault(source.providerId, defaultDesktopSettings.providerId),
    startOnLaunch: booleanOrDefault(source.startOnLaunch, defaultDesktopSettings.startOnLaunch),
    writeCodexConfigOnStart: booleanOrDefault(
      source.writeCodexConfigOnStart,
      defaultDesktopSettings.writeCodexConfigOnStart,
    ),
  };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function portOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535
    ? value
    : fallback;
}
