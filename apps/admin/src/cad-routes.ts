import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { parseCadManifest, type CadMcpServer } from "@codex-login-tools/shared";
import { isCadArtifactKind, saveArtifactWithHash, type CadStore } from "./cad-store.js";
import type { AdminStore } from "./store.js";

export interface RegisterCadRoutesOptions {
  cadStore: CadStore;
  adminStore: AdminStore;
  adminToken: string;
  clientToken: string;
}

// 注册 CAD 能力包相关路由：
// - /api/admin/cad/*    管理端（Bearer adminToken）：维护 manifest 与工件
// - /api/gateway/cad/*  客户端（Bearer 客户端令牌）：拉取 manifest 与下载工件
export function registerCadRoutes(app: FastifyInstance, options: RegisterCadRoutesOptions): void {
  const { cadStore, adminStore, adminToken, clientToken } = options;

  const requireAdmin = (auth: string | undefined): boolean =>
    auth === `Bearer ${adminToken}`;

  const validateClient = (auth: string | undefined) =>
    adminStore.validateClientToken(parseBearer(auth) ?? "", clientToken);

  // ---- 管理端 ----

  app.get("/api/admin/cad/manifest", async (request, reply) => {
    if (!requireAdmin(request.headers.authorization)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    return cadStore.getManifest();
  });

  app.put<{ Body: { servers?: CadMcpServer[] } }>(
    "/api/admin/cad/mcp-servers",
    async (request, reply) => {
      if (!requireAdmin(request.headers.authorization)) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const servers = request.body?.servers;
      if (!Array.isArray(servers)) {
        return reply.status(400).send({ error: "servers array is required" });
      }
      try {
        // 先按目标 mcpServers 试解析，捕获 bundle 引用 / name 冲突错误
        parseCadManifest({ ...cadStore.getManifest(), mcpServers: servers });
        return { ok: true, manifest: cadStore.setMcpServers(servers) };
      } catch (error) {
        return reply.status(400).send({ error: errorMessage(error) });
      }
    },
  );

  app.put<{ Params: { kind: string; id: string }; Body: Readable }>(
    "/api/admin/cad/artifacts/:kind/:id",
    async (request, reply) => {
      if (!requireAdmin(request.headers.authorization)) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const { kind, id } = request.params;
      if (!isCadArtifactKind(kind)) {
        return reply.status(400).send({ error: "invalid artifact kind" });
      }
      if (!isReadable(request.body)) {
        return reply.status(400).send({ error: "artifact file is required" });
      }

      const name = header(request.headers["x-artifact-name"])?.trim();
      const ver = header(request.headers["x-artifact-version"])?.trim();
      if (!name) {
        return reply.status(400).send({ error: "x-artifact-name header is required" });
      }
      if (!ver) {
        return reply.status(400).send({ error: "x-artifact-version header is required" });
      }

      const targetPath = cadStore.artifactFilePath(kind, id);
      mkdirSync(cadStore.artifactDir(kind), { recursive: true });
      const { size, sha256 } = await saveArtifactWithHash(request.body, targetPath);
      if (size === 0) {
        rmSync(targetPath, { force: true });
        return reply.status(400).send({ error: "artifact file is required" });
      }

      try {
        const manifest = cadStore.upsertArtifact({ kind, id, name, ver, sha256, size });
        return { ok: true, manifest };
      } catch (error) {
        rmSync(targetPath, { force: true });
        return reply.status(400).send({ error: errorMessage(error) });
      }
    },
  );

  app.delete<{ Params: { kind: string; id: string } }>(
    "/api/admin/cad/artifacts/:kind/:id",
    async (request, reply) => {
      if (!requireAdmin(request.headers.authorization)) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const { kind, id } = request.params;
      if (!isCadArtifactKind(kind)) {
        return reply.status(400).send({ error: "invalid artifact kind" });
      }
      try {
        const manifest = cadStore.removeArtifact(kind, id);
        if (!manifest) {
          return reply.status(404).send({ error: "artifact not found" });
        }
        return { ok: true, manifest };
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    },
  );

  // ---- 客户端 ----

  app.get("/api/gateway/cad/manifest", async (request, reply) => {
    const validation = validateClient(request.headers.authorization);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }
    return cadStore.getManifest();
  });

  app.get<{ Params: { kind: string; id: string } }>(
    "/api/gateway/cad/artifacts/:kind/:id/download",
    async (request, reply) => {
      const validation = validateClient(request.headers.authorization);
      if (!validation.ok) {
        return reply.status(validation.statusCode).send({ error: validation.error });
      }
      const { kind, id } = request.params;
      if (!isCadArtifactKind(kind)) {
        return reply.status(400).send({ error: "invalid artifact kind" });
      }
      const artifact = cadStore.findArtifact(kind, id);
      const filePath = cadStore.artifactFilePath(kind, id);
      if (!artifact || !existsSync(filePath)) {
        return reply.status(404).send({ error: "artifact not found" });
      }
      reply.header("content-type", "application/octet-stream");
      reply.header("content-length", String(artifact.size));
      reply.header("x-artifact-sha256", artifact.sha256);
      reply.header("x-artifact-version", artifact.ver);
      reply.header(
        "content-disposition",
        `attachment; filename="${encodeURIComponent(id)}.bin"`,
      );
      return reply.send(createReadStream(filePath));
    },
  );
}

function parseBearer(header: string | undefined): string | undefined {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable || (typeof value === "object" && value !== null && "pipe" in value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid request";
}
