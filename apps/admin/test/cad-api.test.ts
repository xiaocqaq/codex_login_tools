import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdminServer } from "../src/app.js";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("cad capability api", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    servers.length = 0;
    dirs.length = 0;
  });

  function makeServer() {
    const server = buildAdminServer({
      adminUser: "admin",
      adminPassword: "secret",
      clientToken: "client-token",
    });
    servers.push(server);
    return server;
  }

  async function adminBearer(server: ReturnType<typeof makeServer>) {
    const login = await server.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { username: "admin", password: "secret" },
    });
    return login.json<{ token: string }>().token;
  }

  it("requires a client token to read the cad manifest", async () => {
    const server = makeServer();
    const res = await server.inject({ method: "GET", url: "/api/gateway/cad/manifest" });
    expect(res.statusCode).toBe(401);
  });

  it("uploads a bundle, records sha256, and lets a client download it", async () => {
    const server = makeServer();
    const token = await adminBearer(server);
    const payload = Buffer.from("fake mcp bundle bytes");

    const upload = await server.inject({
      method: "PUT",
      url: "/api/admin/cad/artifacts/bundles/cad-mcp-win",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-artifact-name": "本地CAD控制",
        "x-artifact-version": "0.1.0",
      },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const uploaded = upload.json<{ manifest: { bundles: Array<{ id: string; sha256: string; size: number }> } }>();
    expect(uploaded.manifest.bundles[0]).toMatchObject({
      id: "cad-mcp-win",
      sha256: sha256(payload),
      size: payload.length,
    });

    // 客户端拉清单
    const manifestRes = await server.inject({
      method: "GET",
      url: "/api/gateway/cad/manifest",
      headers: { authorization: "Bearer client-token" },
    });
    expect(manifestRes.statusCode).toBe(200);
    expect(manifestRes.json().bundles[0].id).toBe("cad-mcp-win");

    // 客户端下载工件并校验 sha256 头与内容
    const download = await server.inject({
      method: "GET",
      url: "/api/gateway/cad/artifacts/bundles/cad-mcp-win/download",
      headers: { authorization: "Bearer client-token" },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["x-artifact-sha256"]).toBe(sha256(payload));
    expect(sha256(download.rawPayload)).toBe(sha256(payload));
  });

  it("sets mcp servers that reference an uploaded bundle", async () => {
    const server = makeServer();
    const token = await adminBearer(server);
    await server.inject({
      method: "PUT",
      url: "/api/admin/cad/artifacts/bundles/cad-mcp-win",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-artifact-name": "本地CAD控制",
        "x-artifact-version": "0.1.0",
      },
      payload: Buffer.from("bytes"),
    });

    const setServers = await server.inject({
      method: "PUT",
      url: "/api/admin/cad/mcp-servers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        servers: [
          {
            name: "cad_local",
            transport: "stdio",
            bundleId: "cad-mcp-win",
            disabledTools: ["run_arbitrary_python"],
          },
        ],
      },
    });
    expect(setServers.statusCode).toBe(200);
    expect(setServers.json().manifest.mcpServers[0].name).toBe("cad_local");
  });

  it("rejects mcp servers referencing a missing bundle", async () => {
    const server = makeServer();
    const token = await adminBearer(server);
    const res = await server.inject({
      method: "PUT",
      url: "/api/admin/cad/mcp-servers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        servers: [{ name: "cad_local", transport: "stdio", bundleId: "ghost" }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/missing bundle/);
  });

  it("refuses to delete a bundle still referenced by an mcp server", async () => {
    const server = makeServer();
    const token = await adminBearer(server);
    await server.inject({
      method: "PUT",
      url: "/api/admin/cad/artifacts/bundles/cad-mcp-win",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-artifact-name": "本地CAD控制",
        "x-artifact-version": "0.1.0",
      },
      payload: Buffer.from("bytes"),
    });
    await server.inject({
      method: "PUT",
      url: "/api/admin/cad/mcp-servers",
      headers: { authorization: `Bearer ${token}` },
      payload: { servers: [{ name: "cad_local", transport: "stdio", bundleId: "cad-mcp-win" }] },
    });

    const del = await server.inject({
      method: "DELETE",
      url: "/api/admin/cad/artifacts/bundles/cad-mcp-win",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toMatch(/still referenced/);
  });

  it("rejects an invalid artifact kind", async () => {
    const server = makeServer();
    const token = await adminBearer(server);
    const res = await server.inject({
      method: "PUT",
      url: "/api/admin/cad/artifacts/malware/x",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-artifact-name": "x",
        "x-artifact-version": "1.0.0",
      },
      payload: Buffer.from("bytes"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid artifact kind/);
  });
});
