import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  emptyCadManifest,
  parseCadManifest,
  type CadArtifact,
  type CadManifest,
  type CadMcpServer,
} from "@codex-login-tools/shared";

// CAD 能力包服务端存储（默认「服务端纯分发」）：
// - manifest.json 持久化清单（skills/scripts/bundles + mcpServers + revision）
// - 每个工件二进制存于 artifacts/<kind>/<id>.bin，上传时计算 sha256
// 服务端不解释工件内容，只做分发与校验。

export type CadArtifactKind = "skills" | "scripts" | "bundles";

const ARTIFACT_KINDS: CadArtifactKind[] = ["skills", "scripts", "bundles"];

export interface UpsertArtifactInput {
  kind: CadArtifactKind;
  id: string;
  name: string;
  ver: string;
  sha256: string;
  size: number;
}

export interface CadStore {
  getManifest: () => CadManifest;
  setMcpServers: (servers: CadMcpServer[]) => CadManifest;
  upsertArtifact: (input: UpsertArtifactInput) => CadManifest;
  removeArtifact: (kind: CadArtifactKind, id: string) => CadManifest | undefined;
  artifactFilePath: (kind: CadArtifactKind, id: string) => string;
  artifactDir: (kind: CadArtifactKind) => string;
  findArtifact: (kind: CadArtifactKind, id: string) => CadArtifact | undefined;
}

export function isCadArtifactKind(value: string): value is CadArtifactKind {
  return (ARTIFACT_KINDS as string[]).includes(value);
}

export function createCadStore(options: { baseDir: string }): CadStore {
  const baseDir = options.baseDir;
  const manifestPath = join(baseDir, "manifest.json");
  let manifest = loadManifest(manifestPath);

  const persist = () => {
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  };

  const artifactDir = (kind: CadArtifactKind) => join(baseDir, "artifacts", kind);
  const artifactFilePath = (kind: CadArtifactKind, id: string) =>
    join(artifactDir(kind), `${sanitizeId(id)}.bin`);

  return {
    getManifest: () => manifest,
    artifactDir,
    artifactFilePath,
    findArtifact: (kind, id) => manifest[kind].find((artifact) => artifact.id === id),
    setMcpServers: (servers) => {
      // 借 parseCadManifest 做 name 唯一 + bundle 引用一致性校验
      manifest = parseCadManifest({
        ...manifest,
        revision: manifest.revision + 1,
        mcpServers: servers,
      });
      persist();
      return manifest;
    },
    upsertArtifact: (input) => {
      const artifact: CadArtifact = {
        id: input.id,
        name: input.name,
        ver: input.ver,
        sha256: input.sha256,
        size: input.size,
      };
      const others = manifest[input.kind].filter((item) => item.id !== input.id);
      manifest = parseCadManifest({
        ...manifest,
        revision: manifest.revision + 1,
        [input.kind]: [...others, artifact],
      });
      persist();
      return manifest;
    },
    removeArtifact: (kind, id) => {
      const exists = manifest[kind].some((artifact) => artifact.id === id);
      if (!exists) {
        return undefined;
      }
      // 删除 bundle 前，若仍被 stdio MCP 引用则拒绝，避免清单失效
      if (kind === "bundles") {
        const referencedBy = manifest.mcpServers.find(
          (server) => server.transport === "stdio" && server.bundleId === id,
        );
        if (referencedBy) {
          throw new Error(`bundle ${id} is still referenced by mcp server ${referencedBy.name}`);
        }
      }
      manifest = parseCadManifest({
        ...manifest,
        revision: manifest.revision + 1,
        [kind]: manifest[kind].filter((artifact) => artifact.id !== id),
      });
      rmSync(artifactFilePath(kind, id), { force: true });
      persist();
      return manifest;
    },
  };
}

// 边流式落盘边计算 sha256，避免二次读盘
export async function saveArtifactWithHash(
  stream: Readable,
  targetPath: string,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  stream.on("data", (chunk: Buffer) => {
    size += chunk.length;
    hash.update(chunk);
  });
  await pipeline(stream, createWriteStream(targetPath));
  return { size, sha256: hash.digest("hex") };
}

function loadManifest(manifestPath: string): CadManifest {
  if (!existsSync(manifestPath)) {
    return emptyCadManifest();
  }
  try {
    return parseCadManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch {
    return emptyCadManifest();
  }
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").trim();
  if (!cleaned) {
    throw new Error("invalid artifact id");
  }
  return cleaned;
}
