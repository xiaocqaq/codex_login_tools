import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { buildGatewayServer } from "../src/app.js";

describe("gateway proxy", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it("fetches remote config, rewrites auth and model, and returns upstream response", async () => {
    let receivedAuth = "";
    let receivedModel = "";

    const upstream = buildTestServer(async (request) => {
      receivedAuth = request.headers.get("authorization") ?? "";
      const body = await request.json();
      receivedModel = body.model;
      return Response.json({ id: "resp_1", object: "response", output: [] });
    });
    servers.push(upstream);
    await upstream.listen({ host: "127.0.0.1", port: 0 });
    const upstreamUrl = `http://127.0.0.1:${upstream.server.address().port}/v1`;

    const configServer = buildTestServer(() =>
      Response.json({
        version: 1,
        pollIntervalSeconds: 10,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: upstreamUrl,
            apiKey: "sk-upstream",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "upstream-model",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      }),
    );
    servers.push(configServer);
    await configServer.listen({ host: "127.0.0.1", port: 0 });

    const gateway = buildGatewayServer({
      configUrl: `http://127.0.0.1:${configServer.server.address().port}/api/gateway/config`,
      clientToken: "client-token",
      fetchImpl: fetch,
    });
    servers.push(gateway);
    await gateway.refreshConfig();

    const response = await gateway.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer codex-placeholder" },
      payload: { model: "codex-best", input: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe("resp_1");
    expect(receivedAuth).toBe("Bearer sk-upstream");
    expect(receivedModel).toBe("upstream-model");
  });

  it("falls back to the next matching route when an upstream has a retryable failure", async () => {
    const attemptedModels: string[] = [];

    const primary = buildTestServer(async (request) => {
      const body = await request.json();
      attemptedModels.push(body.model);
      return Response.json({ error: "temporary failure" }, { status: 500 });
    });
    servers.push(primary);
    await primary.listen({ host: "127.0.0.1", port: 0 });

    const backup = buildTestServer(async (request) => {
      const body = await request.json();
      attemptedModels.push(body.model);
      return Response.json({ id: "resp_backup", object: "response", output: [] });
    });
    servers.push(backup);
    await backup.listen({ host: "127.0.0.1", port: 0 });

    const configServer = buildTestServer(() =>
      Response.json({
        version: 1,
        pollIntervalSeconds: 10,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: `http://127.0.0.1:${primary.server.address().port}/v1`,
            apiKey: "sk-primary",
            enabled: true,
          },
          {
            id: "backup",
            name: "Backup",
            baseUrl: `http://127.0.0.1:${backup.server.address().port}/v1`,
            apiKey: "sk-backup",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "primary-route",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "primary-model",
            enabled: true,
            priority: 100,
          },
          {
            id: "backup-route",
            providerId: "backup",
            matchModel: "*",
            upstreamModel: "backup-model",
            enabled: true,
            priority: 50,
          },
        ],
        defaultRouteId: "primary-route",
      }),
    );
    servers.push(configServer);
    await configServer.listen({ host: "127.0.0.1", port: 0 });

    const gateway = buildGatewayServer({
      configUrl: `http://127.0.0.1:${configServer.server.address().port}/api/gateway/config`,
      clientToken: "client-token",
      fetchImpl: fetch,
    });
    servers.push(gateway);
    await gateway.refreshConfig();

    const response = await gateway.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "codex-best", input: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe("resp_backup");
    expect(attemptedModels).toEqual(["primary-model", "backup-model"]);
  });

  it("keeps running but rejects proxy requests after the server disables the token", async () => {
    const configServer = buildTestServer(() =>
      Response.json({ error: "token disabled" }, { status: 403 }),
    );
    servers.push(configServer);
    await configServer.listen({ host: "127.0.0.1", port: 0 });

    const gateway = buildGatewayServer({
      configUrl: `http://127.0.0.1:${configServer.server.address().port}/api/gateway/config`,
      clientToken: "disabled-token",
      fetchImpl: fetch,
    });
    servers.push(gateway);

    await expect(gateway.refreshConfig()).rejects.toThrow("token disabled");

    const response = await gateway.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "codex-best", input: "hello" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("token disabled");
  });

  it("accumulates response usage and reports it in a batch", async () => {
    let reportedUsage: Record<string, unknown> | undefined;
    const upstream = buildTestServer(() =>
      Response.json({
        id: "resp_usage",
        object: "response",
        output: [],
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18,
          input_tokens_details: { cached_tokens: 3 },
        },
      }),
    );
    servers.push(upstream);
    await upstream.listen({ host: "127.0.0.1", port: 0 });

    const admin = buildTestServer(async (request) => {
      if (new URL(request.url).pathname === "/api/gateway/usage") {
        reportedUsage = await request.json();
        return Response.json({ ok: true });
      }

      return Response.json({
        version: 1,
        pollIntervalSeconds: 10,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: `http://127.0.0.1:${upstream.server.address().port}/v1`,
            apiKey: "sk-upstream",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "upstream-model",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      });
    });
    servers.push(admin);
    await admin.listen({ host: "127.0.0.1", port: 0 });

    const gateway = buildGatewayServer({
      configUrl: `http://127.0.0.1:${admin.server.address().port}/api/gateway/config`,
      usageUrl: `http://127.0.0.1:${admin.server.address().port}/api/gateway/usage`,
      clientToken: "client-token",
      fetchImpl: fetch,
    });
    servers.push(gateway);
    await gateway.refreshConfig();

    const response = await gateway.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "codex-best", input: "hello" },
    });
    expect(response.statusCode).toBe(200);

    await gateway.flushUsage();

    expect(reportedUsage).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      cachedInputTokens: 3,
      totalTokens: 18,
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
    });
  });

  it("accumulates streaming response usage and reports it in a batch", async () => {
    let reportedUsage: Record<string, unknown> | undefined;
    const upstream = buildTestServer(() => {
      const body = [
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"hello"}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":13,"output_tokens":9,"total_tokens":22,"input_tokens_details":{"cached_tokens":5}}}}',
        '',
        'data: [DONE]',
        '',
      ].join("\n");
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    servers.push(upstream);
    await upstream.listen({ host: "127.0.0.1", port: 0 });

    const admin = buildTestServer(async (request) => {
      if (new URL(request.url).pathname === "/api/gateway/usage") {
        reportedUsage = await request.json();
        return Response.json({ ok: true });
      }

      return Response.json({
        version: 1,
        pollIntervalSeconds: 10,
        providers: [
          {
            id: "primary",
            name: "Primary",
            baseUrl: `http://127.0.0.1:${upstream.server.address().port}/v1`,
            apiKey: "sk-upstream",
            enabled: true,
          },
        ],
        routes: [
          {
            id: "default",
            providerId: "primary",
            matchModel: "*",
            upstreamModel: "upstream-model",
            enabled: true,
            priority: 100,
          },
        ],
        defaultRouteId: "default",
      });
    });
    servers.push(admin);
    await admin.listen({ host: "127.0.0.1", port: 0 });

    const gateway = buildGatewayServer({
      configUrl: `http://127.0.0.1:${admin.server.address().port}/api/gateway/config`,
      usageUrl: `http://127.0.0.1:${admin.server.address().port}/api/gateway/usage`,
      clientToken: "client-token",
      fetchImpl: fetch,
    });
    servers.push(gateway);
    await gateway.refreshConfig();

    const response = await gateway.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "codex-best", input: "hello", stream: true },
    });
    expect(response.statusCode).toBe(200);

    await gateway.flushUsage();

    expect(reportedUsage).toMatchObject({
      inputTokens: 13,
      outputTokens: 9,
      cachedInputTokens: 5,
      totalTokens: 22,
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
    });
  });
});

function buildTestServer(handler: (request: Request) => Promise<Response> | Response) {
  const server = Fastify({ logger: false });
  server.all("/*", async (request, reply) => {
    const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
    const response = await handler(
      new Request(new URL(request.url, origin), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: request.body ? JSON.stringify(request.body) : undefined,
      }),
    );
    reply.status(response.status);
    response.headers.forEach((value, name) => reply.header(name, value));
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  return server;
}
