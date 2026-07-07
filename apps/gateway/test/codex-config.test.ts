import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeCodexGatewayConfig } from "../src/codex-config.js";

describe("writeCodexGatewayConfig", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("preserves existing config and appends gateway provider block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-gateway-"));
    dirs.push(dir);
    const configPath = join(dir, "config.toml");
    await writeFile(configPath, 'model = "existing"\n');

    await writeCodexGatewayConfig({
      configPath,
      port: 17861,
      providerId: "friend_gateway",
      model: "codex-best",
    });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain('model_provider = "friend_gateway"');
    expect(content).toContain('base_url = "http://127.0.0.1:17861/v1"');
    expect(content).toContain("# BEGIN CODEX LOGIN TOOLS GATEWAY");
  });
});
