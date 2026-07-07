import {
  findProvider,
  parseRemoteConfig,
  selectRouteCandidates,
  type RemoteConfig,
} from "@codex-login-tools/shared";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

type FetchImpl = typeof fetch;

export interface GatewayOptions {
  configUrl: string;
  clientToken: string;
  usageUrl?: string;
  fetchImpl?: FetchImpl;
  proxyHandler?: (request: Request) => Promise<Response> | Response;
}

export interface GatewayServer extends FastifyInstance {
  refreshConfig: () => Promise<RemoteConfig>;
  getCurrentConfig: () => RemoteConfig | undefined;
  flushUsage: () => Promise<void>;
}

interface UsageCounters {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function buildGatewayServer(options: GatewayOptions): GatewayServer {
  const app = Fastify({ logger: false }) as unknown as GatewayServer;
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentConfig: RemoteConfig | undefined;
  let lastConfigRefreshAt: string | undefined;
  let tokenDisabled = false;
  let pendingUsage: UsageCounters = emptyUsage();

  app.decorate("refreshConfig", async () => {
    const response = await fetchImpl(options.configUrl, {
      headers: { authorization: `Bearer ${options.clientToken}` },
    });
    if (!response.ok) {
      const errorMessage = await readErrorMessage(response);
      tokenDisabled = response.status === 403 && errorMessage === "token disabled";
      throw new Error(errorMessage || `config fetch failed with status ${response.status}`);
    }
    tokenDisabled = false;
    currentConfig = parseRemoteConfig(await response.json());
    lastConfigRefreshAt = new Date().toISOString();
    return currentConfig;
  });

  app.decorate("getCurrentConfig", () => currentConfig);
  app.decorate("flushUsage", async () => {
    if (!options.usageUrl || isEmptyUsage(pendingUsage)) {
      return;
    }

    const usage = pendingUsage;
    pendingUsage = emptyUsage();
    try {
      const response = await fetchImpl(options.usageUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.clientToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(usage),
      });
      if (!response.ok) {
        addUsage(pendingUsage, usage);
      }
    } catch {
      addUsage(pendingUsage, usage);
    }
  });

  app.get("/health", async () => ({
    ok: true,
    hasConfig: Boolean(currentConfig),
    lastConfigRefreshAt,
    tokenDisabled,
  }));

  app.get("/gateway/status", async () => ({
    hasConfig: Boolean(currentConfig),
    lastConfigRefreshAt,
    tokenDisabled,
    listenPort: process.env.GATEWAY_PORT ?? "17861",
  }));

  app.all("/v1/*", async (request, reply) => {
    if (options.proxyHandler) {
      const testResponse = await options.proxyHandler(toWebRequest(request));
      return sendWebResponse(reply, testResponse);
    }

    if (tokenDisabled) {
      addUsage(pendingUsage, { ...emptyUsage(), requestCount: 1, failureCount: 1 });
      return reply.status(403).send({ error: "token disabled" });
    }

    if (!currentConfig) {
      try {
        await app.refreshConfig();
      } catch (error) {
        if (tokenDisabled) {
          addUsage(pendingUsage, { ...emptyUsage(), requestCount: 1, failureCount: 1 });
          return reply.status(403).send({ error: "token disabled" });
        }
        throw error;
      }
    }

    const config = currentConfig;
    if (!config) {
      return reply.status(503).send({ error: "gateway config is not loaded" });
    }

    const body = await readJsonBody(request.body);
    const requestedModel = typeof body.model === "string" ? body.model : undefined;
    const upstreamResponse = await fetchWithFallback({
      config,
      requestedModel,
      requestUrl: request.url,
      requestMethod: request.method,
      requestHeaders: request.headers,
      requestBody: body,
      fetchImpl,
    });

    await collectUsage(upstreamResponse, pendingUsage);

    return sendWebResponse(reply, upstreamResponse);
  });

  return app;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

async function collectUsage(response: Response, pendingUsage: UsageCounters): Promise<void> {
  const successCount = response.ok ? 1 : 0;
  const failureCount = response.ok ? 0 : 1;
  let usage = emptyUsage();

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.clone().json()) as Record<string, unknown>;
      usage = parseUsage(body.usage);
    }
  } catch {
    usage = emptyUsage();
  }

  addUsage(pendingUsage, {
    ...usage,
    requestCount: 1,
    successCount,
    failureCount,
  });
}

function parseUsage(input: unknown): UsageCounters {
  const usage = input as Record<string, unknown> | undefined;
  const details = usage?.input_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens: numberOrZero(usage?.input_tokens),
    outputTokens: numberOrZero(usage?.output_tokens),
    cachedInputTokens: numberOrZero(details?.cached_tokens),
    totalTokens: numberOrZero(usage?.total_tokens),
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
  };
}

function emptyUsage(): UsageCounters {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
  };
}

function addUsage(target: UsageCounters, input: UsageCounters): void {
  target.inputTokens += input.inputTokens;
  target.outputTokens += input.outputTokens;
  target.cachedInputTokens += input.cachedInputTokens;
  target.totalTokens += input.totalTokens;
  target.requestCount += input.requestCount;
  target.successCount += input.successCount;
  target.failureCount += input.failureCount;
}

function isEmptyUsage(input: UsageCounters): boolean {
  return (
    input.inputTokens === 0 &&
    input.outputTokens === 0 &&
    input.cachedInputTokens === 0 &&
    input.totalTokens === 0 &&
    input.requestCount === 0 &&
    input.successCount === 0 &&
    input.failureCount === 0
  );
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface FetchWithFallbackOptions {
  config: RemoteConfig;
  requestedModel?: string;
  requestUrl: string;
  requestMethod: string;
  requestHeaders: Record<string, string | string[] | undefined>;
  requestBody: Record<string, unknown>;
  fetchImpl: FetchImpl;
}

async function fetchWithFallback(options: FetchWithFallbackOptions): Promise<Response> {
  const routes = selectRouteCandidates(options.config, options.requestedModel);
  let lastFailure: Error | Response | undefined;

  for (const route of routes) {
    const provider = findProvider(options.config, route.providerId);
    const upstreamUrl = buildUpstreamUrl(provider.baseUrl, options.requestUrl);
    const upstreamBody = JSON.stringify({
      ...options.requestBody,
      model: route.upstreamModel,
    });

    try {
      const response = await options.fetchImpl(upstreamUrl, {
        method: options.requestMethod,
        headers: buildUpstreamHeaders(options.requestHeaders, provider.apiKey),
        body: upstreamBody,
      });

      if (!isRetryableStatus(response.status) || route === routes[routes.length - 1]) {
        return response;
      }

      await drainResponse(response);
      lastFailure = response;
    } catch (error) {
      lastFailure = error instanceof Error ? error : new Error(String(error));
      if (route === routes[routes.length - 1]) {
        throw lastFailure;
      }
    }
  }

  if (lastFailure instanceof Response) {
    return lastFailure;
  }
  throw lastFailure ?? new Error("no route candidates available");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function drainResponse(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Ignore body drain failures before trying fallback routes.
  }
}

function buildUpstreamUrl(baseUrl: string, requestUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const path = requestUrl.startsWith("/v1") ? requestUrl.slice(3) : requestUrl;
  return `${base}${path}`;
}

function buildUpstreamHeaders(
  headers: Record<string, string | string[] | undefined>,
  apiKey: string,
): Headers {
  const upstreamHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (hopByHopHeaders.has(lowerName) || lowerName === "authorization" || value === undefined) {
      continue;
    }
    upstreamHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  upstreamHeaders.set("authorization", `Bearer ${apiKey}`);
  upstreamHeaders.set("content-type", "application/json");
  return upstreamHeaders;
}

async function readJsonBody(body: unknown): Promise<Record<string, unknown>> {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as Record<string, unknown>;
}

async function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.status(response.status);
  response.headers.forEach((value, name) => {
    if (!hopByHopHeaders.has(name.toLowerCase())) {
      reply.header(name, value);
    }
  });

  if (response.body) {
    return reply.send(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
    );
  }

  return reply.send();
}

function toWebRequest(request: FastifyRequest): Request {
  const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
  return new Request(new URL(request.url, origin), {
    method: request.method,
    headers: request.headers as HeadersInit,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
}
