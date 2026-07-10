import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { parseRemoteConfig, type RemoteConfig } from "@codex-login-tools/shared";
import Fastify, { type FastifyInstance } from "fastify";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createAdminStore, mergeRedactedApiKeys, type UsageCounters } from "./store.js";

export interface AdminServerOptions {
  adminUser: string;
  adminPassword: string;
  clientToken: string;
  initialConfig?: RemoteConfig;
  dataPath?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
}

interface TokenBody {
  name?: string;
  note?: string;
  enabled?: boolean;
  allowedRouteIds?: string[];
  deviceLimit?: number;
}

interface InstallerMeta {
  fileName: string;
  size: number;
  updatedAt: string;
  downloadUrl?: string;
  storeProductId?: string;
}

interface ClientReleaseMeta extends InstallerMeta {
  version: string;
}

type ManagedPackageStatus<TMeta extends InstallerMeta> =
  | { uploaded: false; hasFile: false; hasUrl: false; hasStore: false }
  | ({
      uploaded: true;
      hasFile: boolean;
      hasUrl: boolean;
      hasStore: boolean;
      preferred: "url" | "file" | "store";
      file?: TMeta;
      url?: TMeta;
      storeProductId?: string;
    } & Partial<TMeta>);

interface InstallerStoreBody {
  storeProductId?: string;
}

interface InstallerUrlBody {
  downloadUrl?: string;
  fileName?: string;
  size?: number;
}

interface ClientReleaseUrlBody extends InstallerUrlBody {
  version?: string;
}

const defaultConfig: RemoteConfig = parseRemoteConfig({
  version: 1,
  pollIntervalSeconds: 60,
  providers: [
    {
      id: "example",
      name: "Example Responses Provider",
      baseUrl: "https://api.example.com/v1",
      apiKey: "replace-me",
      enabled: true,
    },
  ],
  routes: [
    {
      id: "default",
      providerId: "example",
      matchModel: "*",
      upstreamModel: "gpt-5.5-compatible",
      enabled: true,
      priority: 100,
    },
  ],
  defaultRouteId: "default",
});

export function buildAdminServer(options: AdminServerOptions): FastifyInstance {
  const store = createAdminStore({
    dataPath: options.dataPath,
    defaultConfig: options.initialConfig ?? defaultConfig,
  });
  const adminToken = createAdminToken(options.adminUser, options.adminPassword);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 * 1024 });
  registerJsonParser(app);
  registerBinaryParser(app);

  app.register(cors, { origin: true });
  registerStatic(app);

  app.get("/health", async () => ({ ok: true }));

  app.post<{ Body: LoginBody }>("/api/admin/login", async (request, reply) => {
    if (
      request.body?.username !== options.adminUser ||
      request.body?.password !== options.adminPassword
    ) {
      return reply.status(401).send({ error: "invalid credentials" });
    }

    return { token: adminToken };
  });

  app.get("/api/admin/config", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return redactConfig(store.getConfig());
  });

  app.put("/api/admin/config", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    try {
      const config = store.saveConfig(mergeRedactedApiKeys(request.body, store.getConfig()));
      return { ok: true, config: redactConfig(config) };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "invalid config",
      });
    }
  });

  app.post<{ Body: TokenBody }>("/api/admin/tokens", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return store.createClientToken(request.body ?? {});
  });

  app.get("/api/admin/tokens", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return { tokens: store.listClientTokens() };
  });

  app.patch<{ Params: { id: string }; Body: TokenBody }>(
    "/api/admin/tokens/:id",
    async (request, reply) => {
      if (!hasBearerToken(request.headers.authorization, adminToken)) {
        return reply.status(401).send({ error: "unauthorized" });
      }

      const token = store.updateClientToken(request.params.id, request.body ?? {});
      if (!token) {
        return reply.status(404).send({ error: "token not found" });
      }
      return { ok: true, token };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/admin/tokens/:id", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const token = store.deleteClientToken(request.params.id);
    if (!token) {
      return reply.status(404).send({ error: "token not found" });
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string; deviceId: string } }>(
    "/api/admin/tokens/:id/devices/:deviceId",
    async (request, reply) => {
      if (!hasBearerToken(request.headers.authorization, adminToken)) {
        return reply.status(401).send({ error: "unauthorized" });
      }

      const token = store.unbindDevice(request.params.id, request.params.deviceId);
      if (!token) {
        return reply.status(404).send({ error: "token not found" });
      }
      return { ok: true, token };
    },
  );

  app.get("/api/admin/dashboard", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return store.getDashboard();
  });

  app.get("/api/admin/codex-desktop-installer", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer");
  });

  app.put<{ Body: Readable }>("/api/admin/codex-desktop-installer", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!isReadable(request.body)) {
      return reply.status(400).send({ error: "installer file is required" });
    }

    const fileName = sanitizeFileName(
      Array.isArray(request.headers["x-file-name"])
        ? request.headers["x-file-name"][0]
        : request.headers["x-file-name"],
    );
    const paths = getManagedFilePaths(options.dataPath, "codex-desktop-installer");
    mkdirSync(paths.dir, { recursive: true });
    const size = await saveUpload(request.body, paths.file);
    if (size === 0) {
      rmSync(paths.file, { force: true });
      return reply.status(400).send({ error: "installer file is required" });
    }

    const meta = {
      fileName,
      size,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(paths.fileMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    return { ok: true, installer: getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer") };
  });

  app.put<{ Body: InstallerUrlBody }>("/api/admin/codex-desktop-installer-url", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const downloadUrl = request.body?.downloadUrl?.trim();
    if (!downloadUrl || !isHttpUrl(downloadUrl)) {
      return reply.status(400).send({ error: "valid downloadUrl is required" });
    }

    const paths = getManagedFilePaths(options.dataPath, "codex-desktop-installer");
    mkdirSync(paths.dir, { recursive: true });
    const meta: InstallerMeta = {
      fileName: sanitizeFileName(request.body?.fileName) || fileNameFromUrl(downloadUrl),
      size: normalizedSize(request.body?.size),
      updatedAt: new Date().toISOString(),
      downloadUrl,
    };
    writeFileSync(paths.urlMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return { ok: true, installer: getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer") };
  });

  app.put<{ Body: InstallerStoreBody }>("/api/admin/codex-desktop-installer-store", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const storeProductId = request.body?.storeProductId?.trim();
    if (!storeProductId) {
      return reply.status(400).send({ error: "storeProductId is required" });
    }

    const paths = getManagedFilePaths(options.dataPath, "codex-desktop-installer");
    mkdirSync(paths.dir, { recursive: true });
    const meta = { storeProductId, updatedAt: new Date().toISOString() };
    writeFileSync(paths.storeMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return { ok: true, installer: getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer") };
  });

  app.delete("/api/admin/codex-desktop-installer-store", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const paths = getManagedFilePaths(options.dataPath, "codex-desktop-installer");
    rmSync(paths.storeMeta, { force: true });
    return { ok: true, installer: getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer") };
  });

  app.delete("/api/admin/codex-desktop-installer", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const paths = getManagedFilePaths(options.dataPath, "codex-desktop-installer");
    const source = readSourceQuery(request.query);
    if (source === "file") {
      rmSync(paths.file, { force: true });
      rmSync(paths.fileMeta, { force: true });
    } else if (source === "url") {
      rmSync(paths.urlMeta, { force: true });
      removeLegacyUrlMeta(paths.legacyMeta);
    } else if (source === "store") {
      rmSync(paths.storeMeta, { force: true });
    } else {
      rmSync(paths.file, { force: true });
      rmSync(paths.fileMeta, { force: true });
      rmSync(paths.urlMeta, { force: true });
      rmSync(paths.legacyMeta, { force: true });
      rmSync(paths.storeMeta, { force: true });
    }
    return { ok: true };
  });

  app.get("/api/admin/client-release", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return getFileStatus<ClientReleaseMeta>(options.dataPath, "client-release");
  });

  app.put<{ Body: Readable }>("/api/admin/client-release", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!isReadable(request.body)) {
      return reply.status(400).send({ error: "client release file is required" });
    }

    const version = readSingleHeader(request.headers["x-version"])?.trim();
    if (!version) {
      return reply.status(400).send({ error: "version is required" });
    }

    const fileName = sanitizeFileName(readSingleHeader(request.headers["x-file-name"]));
    const paths = getManagedFilePaths(options.dataPath, "client-release");
    mkdirSync(paths.dir, { recursive: true });
    const size = await saveUpload(request.body, paths.file);
    if (size === 0) {
      rmSync(paths.file, { force: true });
      return reply.status(400).send({ error: "client release file is required" });
    }

    const meta: ClientReleaseMeta = {
      version,
      fileName,
      size,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(paths.fileMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    return { ok: true, release: getFileStatus<ClientReleaseMeta>(options.dataPath, "client-release") };
  });

  app.put<{ Body: ClientReleaseUrlBody }>("/api/admin/client-release-url", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const version = request.body?.version?.trim();
    const downloadUrl = request.body?.downloadUrl?.trim();
    if (!version) {
      return reply.status(400).send({ error: "version is required" });
    }
    if (!downloadUrl || !isHttpUrl(downloadUrl)) {
      return reply.status(400).send({ error: "valid downloadUrl is required" });
    }

    const paths = getManagedFilePaths(options.dataPath, "client-release");
    mkdirSync(paths.dir, { recursive: true });
    const meta: ClientReleaseMeta = {
      version,
      fileName: sanitizeFileName(request.body?.fileName) || fileNameFromUrl(downloadUrl),
      size: normalizedSize(request.body?.size),
      updatedAt: new Date().toISOString(),
      downloadUrl,
    };
    writeFileSync(paths.urlMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return { ok: true, release: getFileStatus<ClientReleaseMeta>(options.dataPath, "client-release") };
  });

  app.delete("/api/admin/client-release", async (request, reply) => {
    if (!hasBearerToken(request.headers.authorization, adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const paths = getManagedFilePaths(options.dataPath, "client-release");
    const source = readSourceQuery(request.query);
    if (source === "file") {
      rmSync(paths.file, { force: true });
      rmSync(paths.fileMeta, { force: true });
    } else if (source === "url") {
      rmSync(paths.urlMeta, { force: true });
      removeLegacyUrlMeta(paths.legacyMeta);
    } else {
      rmSync(paths.file, { force: true });
      rmSync(paths.fileMeta, { force: true });
      rmSync(paths.urlMeta, { force: true });
      rmSync(paths.legacyMeta, { force: true });
    }
    return { ok: true };
  });

  app.get("/api/gateway/config", async (request, reply) => {
    const auth = parseBearerToken(request.headers.authorization);
    const validation = store.validateClientToken(auth ?? "", options.clientToken);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }

    if (validation.token) {
      const deviceId = readSingleHeader(request.headers["x-device-id"]) ?? "";
      const deviceName = decodeHeader(readSingleHeader(request.headers["x-device-name"]));
      const device = store.authorizeDevice(validation.token, deviceId, deviceName);
      if (!device.ok) {
        return reply.status(403).send({ error: device.error });
      }
    }

    const config = store.getConfigForToken(validation.token);
    if (!config) {
      return reply.status(403).send({ error: "no model authorized" });
    }

    return config;
  });

  app.post<{ Body: Partial<UsageCounters> }>("/api/gateway/usage", async (request, reply) => {
    const auth = parseBearerToken(request.headers.authorization);
    const validation = store.validateClientToken(auth ?? "", options.clientToken);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }
    if (!validation.token) {
      return { ok: true, ignored: "legacy token" };
    }

    store.recordUsage(validation.token, request.body as UsageCounters);
    return { ok: true };
  });

  app.get("/api/gateway/codex-desktop-installer", async (request, reply) => {
    const auth = parseBearerToken(request.headers.authorization);
    const validation = store.validateClientToken(auth ?? "", options.clientToken);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }

    const status = getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer");
    if (!status.uploaded) {
      return reply.status(404).send({ error: "Codex 桌面版安装包未上传" });
    }
    const source = readSourceQuery(request.query);
    if (status.downloadUrl && source !== "file") {
      return reply.redirect(status.downloadUrl);
    }

    const paths = getManagedFilePaths(options.dataPath, "codex-desktop-installer");
    if (!existsSync(paths.file)) {
      return reply.status(404).send({ error: "Codex 桌面版安装包文件未上传" });
    }
    reply.header("content-type", "application/octet-stream");
    reply.header("content-length", String(statSync(paths.file).size));
    reply.header("content-disposition", `attachment; filename="${encodeURIComponent(status.file?.fileName ?? status.fileName ?? "codex-desktop-installer")}"`);
    return reply.send(createReadStream(paths.file));
  });

  app.get("/api/gateway/codex-desktop-installer/status", async (request, reply) => {
    const auth = parseBearerToken(request.headers.authorization);
    const validation = store.validateClientToken(auth ?? "", options.clientToken);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }

    return getFileStatus<InstallerMeta>(options.dataPath, "codex-desktop-installer");
  });

  app.get("/api/gateway/client-release", async (request, reply) => {
    const auth = parseBearerToken(request.headers.authorization);
    const validation = store.validateClientToken(auth ?? "", options.clientToken);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }

    return getFileStatus<ClientReleaseMeta>(options.dataPath, "client-release");
  });

  app.get("/api/gateway/client-release/download", async (request, reply) => {
    const auth = parseBearerToken(request.headers.authorization);
    const validation = store.validateClientToken(auth ?? "", options.clientToken);
    if (!validation.ok) {
      return reply.status(validation.statusCode).send({ error: validation.error });
    }

    const status = getFileStatus<ClientReleaseMeta>(options.dataPath, "client-release");
    if (!status.uploaded) {
      return reply.status(404).send({ error: "client release not uploaded" });
    }
    const source = readSourceQuery(request.query);
    if (status.downloadUrl && source !== "file") {
      return reply.redirect(status.downloadUrl);
    }

    const paths = getManagedFilePaths(options.dataPath, "client-release");
    if (!existsSync(paths.file)) {
      return reply.status(404).send({ error: "client release file not uploaded" });
    }
    reply.header("content-type", "application/octet-stream");
    reply.header("content-length", String(statSync(paths.file).size));
    reply.header("content-disposition", `attachment; filename="${encodeURIComponent(status.file?.fileName ?? status.fileName ?? "client-release")}"`);
    reply.header("x-version", status.file?.version ?? status.version ?? "");
    return reply.send(createReadStream(paths.file));
  });

  return app;
}

function createAdminToken(user: string, password: string): string {
  return Buffer.from(`${user}:${password}`).toString("base64url");
}

function hasBearerToken(header: string | undefined, expected: string): boolean {
  return header === `Bearer ${expected}`;
}

function parseBearerToken(header: string | undefined): string | undefined {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function redactConfig(config: RemoteConfig): RemoteConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: provider.apiKey === "replace-me" ? provider.apiKey : "********",
    })),
  };
}

function registerStatic(app: FastifyInstance): void {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(currentDir, "..", "public");
  app.register(staticPlugin, { root: publicDir });
}

function registerJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(text) as unknown);
    } catch (error) {
      done(error as Error, undefined);
    }
  });
}

function registerBinaryParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/octet-stream",
    { bodyLimit: 2 * 1024 * 1024 * 1024 },
    (_request, payload, done) => {
      done(null, payload);
    },
  );
}

async function saveUpload(stream: Readable, targetPath: string): Promise<number> {
  let size = 0;
  stream.on("data", (chunk: Buffer) => {
    size += chunk.length;
  });
  await pipeline(stream, createWriteStream(targetPath));
  return size;
}

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable || (typeof value === "object" && value !== null && "pipe" in value);
}

function getFileStatus<TMeta extends InstallerMeta>(
  dataPath: string | undefined,
  name: string,
): ManagedPackageStatus<TMeta> {
  const paths = getManagedFilePaths(dataPath, name);
  const legacyMeta = readManagedMeta<TMeta>(paths.legacyMeta);
  const fileMeta = readManagedMeta<TMeta>(paths.fileMeta) ?? (legacyMeta?.downloadUrl ? undefined : legacyMeta);
  const urlMeta = readManagedMeta<TMeta>(paths.urlMeta) ?? (legacyMeta?.downloadUrl ? legacyMeta : undefined);
  const storeMeta = readManagedMeta<{ storeProductId?: string }>(paths.storeMeta);
  const file = buildFileMeta(paths.file, fileMeta, name);
  const url = urlMeta?.downloadUrl ? urlMeta : undefined;
  const storeProductId = storeMeta?.storeProductId?.trim() || undefined;

  if (!file && !url && !storeProductId) {
    return { uploaded: false, hasFile: false, hasUrl: false, hasStore: false };
  }

  const preferred = url ?? file;
  const preferredSource: "url" | "file" | "store" = url ? "url" : file ? "file" : "store";

  return {
    uploaded: true,
    hasFile: Boolean(file),
    hasUrl: Boolean(url),
    hasStore: Boolean(storeProductId),
    preferred: preferredSource,
    file,
    url,
    storeProductId,
    ...preferred,
  } as ManagedPackageStatus<TMeta>;
}

function readManagedMeta<TMeta>(path: string): TMeta | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TMeta;
  } catch {
    return undefined;
  }
}

function removeLegacyUrlMeta(path: string): void {
  const legacyMeta = readManagedMeta<InstallerMeta>(path);
  if (legacyMeta?.downloadUrl) {
    rmSync(path, { force: true });
  }
}

function buildFileMeta<TMeta extends InstallerMeta>(
  path: string,
  meta: TMeta | undefined,
  fallbackName: string,
): TMeta | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  const stat = statSync(path);
  return {
    fileName: meta?.fileName ?? fallbackName,
    size: meta?.size ?? stat.size,
    updatedAt: meta?.updatedAt ?? stat.mtime.toISOString(),
    ...meta,
    downloadUrl: undefined,
  } as TMeta;
}

function getManagedFilePaths(dataPath: string | undefined, name: string): {
  dir: string;
  file: string;
  legacyMeta: string;
  fileMeta: string;
  urlMeta: string;
  storeMeta: string;
} {
  const dir = join(dataPath ? dirname(dataPath) : "data", "installers");
  return {
    dir,
    file: join(dir, `${name}.bin`),
    legacyMeta: join(dir, `${name}.json`),
    fileMeta: join(dir, `${name}.file.json`),
    urlMeta: join(dir, `${name}.url.json`),
    storeMeta: join(dir, `${name}.store.json`),
  };
}

function readSourceQuery(query: unknown): string {
  if (!query || typeof query !== "object" || !("source" in query)) {
    return "";
  }

  return String((query as { source?: unknown }).source ?? "");
}

function sanitizeFileName(input: string | undefined): string {
  const fileName = decodeURIComponent(input ?? "").split(/[\\/]/).pop()?.trim();
  return fileName || "codex-desktop-installer";
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeHeader(value: string | undefined): string {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function fileNameFromUrl(value: string): string {
  try {
    return sanitizeFileName(new URL(value).pathname.split("/").pop());
  } catch {
    return "download.bin";
  }
}

function normalizedSize(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0;
}
