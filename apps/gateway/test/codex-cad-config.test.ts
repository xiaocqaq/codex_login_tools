import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeCodexCadMcpConfig } from "../src/codex-cad-config.js";

describe("writeCodexCadMcpConfig", () => {
  const dirs: string[] = [];

  async function makeConfigPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "codex-cad-"));
    dirs.push(dir);
    return join(dir, "config.toml");
  }

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("writes a stdio mcp block and preserves existing config", async () => {
    const configPath = await makeConfigPath();
    await writeFile(configPath, 'model = "existing"\n');

    await writeCodexCadMcpConfig({
      configPath,
      servers: [
        {
          name: "cad_local",
          transport: "stdio",
          command: "C:\\Program Files\\cad\\cad-mcp.exe",
          args: ["--stdio"],
          disabledTools: ["run_arbitrary_python"],
          startupTimeoutSec: 30,
        },
      ],
    });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain('model = "existing"');
    expect(content).toContain("# BEGIN CODEX CAD MCP");
    expect(content).toContain("[mcp_servers.cad_local]");
    // Windows 路径用字面量单引号串，避免反斜杠转义问题
    expect(content).toContain("command = 'C:\\Program Files\\cad\\cad-mcp.exe'");
    expect(content).toContain("args = ['--stdio']");
    expect(content).toContain("startup_timeout_sec = 30");
    expect(content).toContain("disabled_tools = ['run_arbitrary_python']");
    expect(content).toContain("# END CODEX CAD MCP");
  });

  it("writes an http mcp block for centralized mode", async () => {
    const configPath = await makeConfigPath();

    await writeCodexCadMcpConfig({
      configPath,
      servers: [
        {
          name: "cad_dxf",
          transport: "http",
          url: "https://cad.example.com/mcp",
          bearerTokenEnvVar: "CAD_MCP_TOKEN",
        },
      ],
    });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("[mcp_servers.cad_dxf]");
    expect(content).toContain("url = 'https://cad.example.com/mcp'");
    expect(content).toContain("bearer_token_env_var = 'CAD_MCP_TOKEN'");
  });

  it("is idempotent: rewriting replaces the managed block, not duplicates it", async () => {
    const configPath = await makeConfigPath();
    const write = () =>
      writeCodexCadMcpConfig({
        configPath,
        servers: [{ name: "cad_local", transport: "stdio", command: "cad-mcp" }],
      });

    await write();
    await write();

    const content = await readFile(configPath, "utf8");
    const occurrences = content.split("# BEGIN CODEX CAD MCP").length - 1;
    expect(occurrences).toBe(1);
  });

  it("removes the managed block when no servers are given", async () => {
    const configPath = await makeConfigPath();
    await writeFile(configPath, 'model = "existing"\n');
    await writeCodexCadMcpConfig({
      configPath,
      servers: [{ name: "cad_local", transport: "stdio", command: "cad-mcp" }],
    });

    await writeCodexCadMcpConfig({ configPath, servers: [] });

    const content = await readFile(configPath, "utf8");
    expect(content).not.toContain("# BEGIN CODEX CAD MCP");
    expect(content).toContain('model = "existing"');
  });

  it("rejects duplicate server names", async () => {
    const configPath = await makeConfigPath();
    await expect(
      writeCodexCadMcpConfig({
        configPath,
        servers: [
          { name: "cad_local", transport: "stdio", command: "a" },
          { name: "cad_local", transport: "stdio", command: "b" },
        ],
      }),
    ).rejects.toThrow(/duplicate mcp server name/);
  });

  it("coexists with the gateway managed block", async () => {
    const configPath = await makeConfigPath();
    await writeFile(
      configPath,
      "# BEGIN CODEX LOGIN TOOLS GATEWAY\nmodel = \"codex-best\"\n# END CODEX LOGIN TOOLS GATEWAY\n",
    );

    await writeCodexCadMcpConfig({
      configPath,
      servers: [{ name: "cad_local", transport: "stdio", command: "cad-mcp" }],
    });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("# BEGIN CODEX LOGIN TOOLS GATEWAY");
    expect(content).toContain("# BEGIN CODEX CAD MCP");
  });
});
