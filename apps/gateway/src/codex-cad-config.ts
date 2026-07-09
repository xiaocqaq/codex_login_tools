import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// 向 ~/.codex/config.toml 幂等写入受管的 CAD MCP 块。
// 默认「全本地执行」：客户端把 manifest 里的 bundleId 解析为本机命令后传入，
// 生成 [mcp_servers.<name>] 表；集中化模式下才出现 url= 的远程 http MCP。

// 已解析为本机可执行形态的 stdio MCP（bundleId → command/args 由客户端完成）
export interface ResolvedStdioMcpServer {
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  disabledTools?: string[];
  enabledTools?: string[];
  startupTimeoutSec?: number;
}

// 远程 http MCP（可选集中化模式）
export interface ResolvedHttpMcpServer {
  name: string;
  transport: "http";
  url: string;
  // bearer 时携带的环境变量名（值不写进配置文件）
  bearerTokenEnvVar?: string;
  disabledTools?: string[];
  enabledTools?: string[];
}

export type ResolvedCadMcpServer = ResolvedStdioMcpServer | ResolvedHttpMcpServer;

export interface WriteCodexCadMcpConfigOptions {
  configPath: string;
  servers: ResolvedCadMcpServer[];
}

const beginMarker = "# BEGIN CODEX CAD MCP";
const endMarker = "# END CODEX CAD MCP";

export async function writeCodexCadMcpConfig(
  options: WriteCodexCadMcpConfigOptions,
): Promise<void> {
  assertUniqueNames(options.servers);

  await mkdir(dirname(options.configPath), { recursive: true });
  const existing = await readExisting(options.configPath);
  const withoutPreviousBlock = removeManagedBlock(existing).trimEnd();

  // 无 server 时移除受管块即可（保留用户其余配置）
  if (options.servers.length === 0) {
    const cleaned = withoutPreviousBlock.length > 0 ? `${withoutPreviousBlock}\n` : "";
    await writeFile(options.configPath, cleaned, { encoding: "utf8" });
    return;
  }

  const managedBlock = buildManagedBlock(options.servers);
  const prefix = withoutPreviousBlock.length > 0 ? `${withoutPreviousBlock}\n\n` : "";
  await writeFile(options.configPath, `${prefix}${managedBlock}\n`, { encoding: "utf8" });
}

function buildManagedBlock(servers: ResolvedCadMcpServer[]): string {
  const lines: string[] = [beginMarker];
  servers.forEach((server, index) => {
    if (index > 0) {
      lines.push("");
    }
    lines.push(`[mcp_servers.${server.name}]`);
    if (server.transport === "stdio") {
      lines.push(`command = ${tomlString(server.command)}`);
      if (server.args && server.args.length > 0) {
        lines.push(`args = ${tomlStringArray(server.args)}`);
      }
      if (typeof server.startupTimeoutSec === "number") {
        lines.push(`startup_timeout_sec = ${Math.floor(server.startupTimeoutSec)}`);
      }
    } else {
      lines.push(`url = ${tomlString(server.url)}`);
      if (server.bearerTokenEnvVar) {
        lines.push(`bearer_token_env_var = ${tomlString(server.bearerTokenEnvVar)}`);
      }
    }
    if (server.enabledTools && server.enabledTools.length > 0) {
      lines.push(`enabled_tools = ${tomlStringArray(server.enabledTools)}`);
    }
    if (server.disabledTools && server.disabledTools.length > 0) {
      lines.push(`disabled_tools = ${tomlStringArray(server.disabledTools)}`);
    }
  });
  lines.push(endMarker);
  return lines.join("\n");
}

// TOML 字符串：优先用字面量单引号串（免转义，适合 Windows 反斜杠路径）；
// 若值本身含单引号，回退到基本双引号串并转义。
function tomlString(value: string): string {
  if (!value.includes("'") && !value.includes("\n")) {
    return `'${value}'`;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function assertUniqueNames(servers: ResolvedCadMcpServer[]): void {
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.name)) {
      throw new Error(`duplicate mcp server name: ${server.name}`);
    }
    seen.add(server.name);
  }
}

async function readExisting(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function removeManagedBlock(content: string): string {
  const start = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return content;
  }

  return `${content.slice(0, start)}${content.slice(end + endMarker.length)}`;
}
