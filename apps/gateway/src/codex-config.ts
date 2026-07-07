import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface WriteCodexGatewayConfigOptions {
  configPath: string;
  port: number;
  providerId: string;
  model: string;
}

const beginMarker = "# BEGIN CODEX LOGIN TOOLS GATEWAY";
const endMarker = "# END CODEX LOGIN TOOLS GATEWAY";

export async function writeCodexGatewayConfig(
  options: WriteCodexGatewayConfigOptions,
): Promise<void> {
  await mkdir(dirname(options.configPath), { recursive: true });
  const existing = await readExisting(options.configPath);
  const withoutPreviousBlock = removeManagedBlock(existing).trimEnd();
  const managedBlock = buildManagedBlock(options);
  const nextContent = `${withoutPreviousBlock}\n\n${managedBlock}\n`;

  await writeFile(options.configPath, nextContent, { encoding: "utf8" });
}

function buildManagedBlock(options: WriteCodexGatewayConfigOptions): string {
  return [
    beginMarker,
    `model_provider = "${options.providerId}"`,
    `model = "${options.model}"`,
    "",
    `[model_providers.${options.providerId}]`,
    `name = "Codex Login Tools Gateway"`,
    `base_url = "http://127.0.0.1:${options.port}/v1"`,
    `wire_api = "responses"`,
    `requires_openai_auth = true`,
    endMarker,
  ].join("\n");
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
