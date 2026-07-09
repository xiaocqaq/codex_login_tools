import { z } from "zod";

// CAD 能力清单（默认「服务端纯分发 / 全本地执行」）
// - 服务端只托管 skills / scripts / 本地 MCP 包（皆为纯数据）
// - 客户端下载后在本机执行；mcpServers 默认全部为 stdio（本机启动，无 url）
// - 集中化模式（可选）下才出现 transport=http + url

const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256Schema = z.string().regex(sha256Pattern, "sha256 must be 64 hex chars");

// 语义化版本号（不含构建元数据），例如 1.2.0
const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "version must be semver like 1.2.0");

// 一个可下载工件（skill 包 / 脚本包）的清单条目
const artifactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ver: semverSchema,
  // 客户端据此校验下载内容是否被篡改
  sha256: sha256Schema,
  // 下发大小（字节），仅用于进度显示，缺省 0
  size: z.number().int().nonnegative().default(0),
});

// 本地 stdio MCP：由客户端启动的本机进程（默认形态）
const stdioMcpSchema = z.object({
  name: z.string().min(1),
  transport: z.literal("stdio"),
  // 对应下发的本地 MCP 包 id（客户端解包后按 bundle 说明启动）
  bundleId: z.string().min(1),
  // 安全门禁：默认禁用危险工具（任意代码执行 / 无差别删除等）
  disabledTools: z.array(z.string().min(1)).default([]),
  // 仅暴露白名单工具（可选，留空表示不限制）
  enabledTools: z.array(z.string().min(1)).default([]),
});

// 远程 http MCP：可选的「集中化模式」，图纸/参数数据会离开本机
const httpMcpSchema = z.object({
  name: z.string().min(1),
  transport: z.literal("http"),
  url: z.string().url(),
  // 复用现有客户端令牌体系；bearer 时用 bearer_token_env_var 携带
  auth: z.enum(["none", "bearer"]).default("none"),
  disabledTools: z.array(z.string().min(1)).default([]),
  enabledTools: z.array(z.string().min(1)).default([]),
});

const mcpServerSchema = z.discriminatedUnion("transport", [stdioMcpSchema, httpMcpSchema]);

const cadManifestSchema = z.object({
  version: z.literal(1),
  // 清单整体修订号，客户端据此判断是否需要刷新
  revision: z.number().int().nonnegative().default(0),
  skills: z.array(artifactSchema).default([]),
  scripts: z.array(artifactSchema).default([]),
  bundles: z.array(artifactSchema).default([]),
  mcpServers: z.array(mcpServerSchema).default([]),
});

export type CadArtifact = z.infer<typeof artifactSchema>;
export type CadStdioMcpServer = z.infer<typeof stdioMcpSchema>;
export type CadHttpMcpServer = z.infer<typeof httpMcpSchema>;
export type CadMcpServer = z.infer<typeof mcpServerSchema>;
export type CadManifest = z.infer<typeof cadManifestSchema>;

export function emptyCadManifest(): CadManifest {
  return cadManifestSchema.parse({ version: 1 });
}

// 解析并做跨字段一致性校验：
// - id 在各工件类型内唯一
// - mcpServers.name 唯一
// - stdio MCP 的 bundleId 必须存在于 bundles 中
export function parseCadManifest(input: unknown): CadManifest {
  const manifest = cadManifestSchema.parse(input);

  assertUniqueIds(manifest.skills, "skills");
  assertUniqueIds(manifest.scripts, "scripts");
  assertUniqueIds(manifest.bundles, "bundles");
  assertUniqueMcpNames(manifest.mcpServers);

  const bundleIds = new Set(manifest.bundles.map((bundle) => bundle.id));
  for (const server of manifest.mcpServers) {
    if (server.transport === "stdio" && !bundleIds.has(server.bundleId)) {
      throw new Error(`mcp server ${server.name} references missing bundle ${server.bundleId}`);
    }
  }

  return manifest;
}

function assertUniqueIds(artifacts: CadArtifact[], label: string): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.id)) {
      throw new Error(`duplicate ${label} id: ${artifact.id}`);
    }
    seen.add(artifact.id);
  }
}

function assertUniqueMcpNames(servers: CadMcpServer[]): void {
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.name)) {
      throw new Error(`duplicate mcp server name: ${server.name}`);
    }
    seen.add(server.name);
  }
}
