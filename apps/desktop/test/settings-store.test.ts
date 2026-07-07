import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultDesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
} from "../src/main/settings-store.js";

describe("desktop settings store", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("returns safe defaults when the file does not exist", async () => {
    const path = await tempSettingsPath();

    await expect(loadDesktopSettings(path)).resolves.toEqual(defaultDesktopSettings);
  });

  it("uses the production admin server as the default config endpoint", () => {
    expect(defaultDesktopSettings.configUrl).toBe("https://admin.xlingo.fun");
  });

  it("falls back to defaults when the file contains invalid settings", async () => {
    const path = await tempSettingsPath();
    await saveText(path, "{ broken json");

    await expect(loadDesktopSettings(path)).resolves.toEqual(defaultDesktopSettings);
  });

  it("saves normalized settings and loads them again", async () => {
    const path = await tempSettingsPath();

    await saveDesktopSettings(path, {
      ...defaultDesktopSettings,
      configUrl: "https://admin.example.com/api/gateway/config",
      clientToken: "friend-token",
      gatewayPort: 19001,
      model: "codex-best",
      startOnLaunch: true,
    });

    await expect(loadDesktopSettings(path)).resolves.toMatchObject({
      configUrl: "https://admin.example.com/api/gateway/config",
      clientToken: "friend-token",
      gatewayPort: 19001,
      model: "codex-best",
      startOnLaunch: true,
    });
  });

  async function tempSettingsPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "codex-desktop-settings-"));
    tempDirs.push(dir);
    return join(dir, "settings.json");
  }

  async function saveText(path: string, content: string): Promise<void> {
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(dirname(path), { recursive: true }).then(() => writeFile(path, content, "utf8")),
    );
  }
});
