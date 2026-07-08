import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseRemoteConfig, type RemoteConfig } from "@codex-login-tools/shared";

export interface BoundDevice {
  deviceId: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ClientTokenRecord {
  id: string;
  name: string;
  note: string;
  tokenValue: string;
  tokenHash: string;
  tokenPreview: string;
  enabled: boolean;
  allowedRouteIds?: string[];
  deviceLimit?: number;
  boundDevices?: BoundDevice[];
  createdAt: string;
  lastUsedAt?: string;
  deletedAt?: string;
}

export interface UsageCounters {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

export interface UsageRecord extends UsageCounters {
  tokenId: string;
  day: string;
}

interface AdminState {
  schemaVersion: 1;
  config: RemoteConfig;
  clientTokens: ClientTokenRecord[];
  usageDaily: UsageRecord[];
}

export interface TokenValidation {
  ok: boolean;
  statusCode: 200 | 401 | 403;
  error?: string;
  token?: ClientTokenRecord;
  legacy?: boolean;
}

export interface AdminStore {
  getConfig: () => RemoteConfig;
  saveConfig: (config: RemoteConfig) => RemoteConfig;
  createClientToken: (input: { name?: string; note?: string }) => {
    token: ClientTokenRecord;
    tokenValue: string;
  };
  listClientTokens: () => ClientTokenRecord[];
  getConfigForToken: (token?: ClientTokenRecord) => RemoteConfig | undefined;
  updateClientToken: (
    id: string,
    input: {
      enabled?: boolean;
      name?: string;
      note?: string;
      allowedRouteIds?: unknown;
      deviceLimit?: number;
    },
  ) => ClientTokenRecord | undefined;
  deleteClientToken: (id: string) => ClientTokenRecord | undefined;
  validateClientToken: (tokenValue: string, legacyToken: string) => TokenValidation;
  authorizeDevice: (
    token: ClientTokenRecord,
    deviceId: string,
    deviceName: string,
  ) => { ok: boolean; error?: string };
  unbindDevice: (id: string, deviceId: string) => ClientTokenRecord | undefined;
  recordUsage: (token: ClientTokenRecord, counters: UsageCounters) => void;
  getDashboard: () => {
    totals: UsageCounters;
    tokens: Array<ClientTokenRecord & UsageCounters>;
  };
}

const zeroCounters: UsageCounters = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  successCount: 0,
  failureCount: 0,
};

export function createAdminStore(options: {
  dataPath?: string;
  defaultConfig: RemoteConfig;
}): AdminStore {
  let state = loadState(options.dataPath, options.defaultConfig);

  const persist = () => saveState(options.dataPath, state);

  return {
    getConfig: () => state.config,
    saveConfig: (config) => {
      state = { ...state, config };
      persist();
      return state.config;
    },
    createClientToken: (input) => {
      const tokenValue = `clt_${randomBytes(32).toString("base64url")}`;
      const token: ClientTokenRecord = {
        id: randomBytes(12).toString("base64url"),
        name: input.name?.trim() || "New token",
        note: input.note?.trim() || "",
        tokenValue,
        tokenHash: hashToken(tokenValue),
        tokenPreview: previewToken(tokenValue),
        enabled: true,
        allowedRouteIds: [],
        deviceLimit: 0,
        boundDevices: [],
        createdAt: new Date().toISOString(),
      };
      state = { ...state, clientTokens: [...state.clientTokens, token] };
      persist();
      return { token, tokenValue };
    },
    listClientTokens: () => state.clientTokens.filter((token) => !token.deletedAt),
    getConfigForToken: (token) => {
      const allowedRouteIds = normalizeAllowedRouteIds(token?.allowedRouteIds);
      if (!allowedRouteIds.length) {
        return state.config;
      }

      const allowed = new Set(allowedRouteIds);
      const routes = state.config.routes.filter((route) => allowed.has(route.id));
      const providerIds = new Set(routes.map((route) => route.providerId));
      const providers = state.config.providers.filter((provider) => providerIds.has(provider.id));
      const enabledProviderIds = new Set(
        providers.filter((provider) => provider.enabled).map((provider) => provider.id),
      );
      const enabledRoutes = routes
        .filter((route) => route.enabled && enabledProviderIds.has(route.providerId))
        .sort((left, right) => right.priority - left.priority);

      if (!enabledRoutes.length) {
        return undefined;
      }

      const defaultRouteId = enabledRoutes.some((route) => route.id === state.config.defaultRouteId)
        ? state.config.defaultRouteId
        : enabledRoutes[0]!.id;

      return {
        ...state.config,
        providers,
        routes,
        defaultRouteId,
      };
    },
    updateClientToken: (id, input) => {
      let updated: ClientTokenRecord | undefined;
      state = {
        ...state,
        clientTokens: state.clientTokens.map((token) => {
          if (token.id !== id || token.deletedAt) {
            return token;
          }
          updated = {
            ...token,
            enabled: typeof input.enabled === "boolean" ? input.enabled : token.enabled,
            name: input.name?.trim() || token.name,
            note: typeof input.note === "string" ? input.note.trim() : token.note,
            allowedRouteIds:
              input.allowedRouteIds === undefined
                ? token.allowedRouteIds
                : normalizeAllowedRouteIds(input.allowedRouteIds),
            deviceLimit:
              input.deviceLimit === undefined
                ? token.deviceLimit
                : normalizeDeviceLimit(input.deviceLimit),
          };
          return updated;
        }),
      };
      if (updated) {
        persist();
      }
      return updated;
    },
    deleteClientToken: (id) => {
      let deleted: ClientTokenRecord | undefined;
      state = {
        ...state,
        clientTokens: state.clientTokens.map((token) => {
          if (token.id !== id || token.deletedAt) {
            return token;
          }
          deleted = { ...token, enabled: false, deletedAt: new Date().toISOString() };
          return deleted;
        }),
      };
      if (deleted) {
        persist();
      }
      return deleted;
    },
    validateClientToken: (tokenValue, legacyToken) => {
      if (tokenValue === legacyToken) {
        return { ok: true, statusCode: 200, legacy: true };
      }

      const token = state.clientTokens.find((candidate) => {
        return candidate.tokenHash === hashToken(tokenValue);
      });

      if (!token) {
        return { ok: false, statusCode: 401, error: "unauthorized" };
      }
      if (!token.enabled || token.deletedAt) {
        return { ok: false, statusCode: 403, error: "token disabled", token };
      }

      token.lastUsedAt = new Date().toISOString();
      persist();
      return { ok: true, statusCode: 200, token };
    },
    authorizeDevice: (token, deviceId, deviceName) => {
      const limit = normalizeDeviceLimit(token.deviceLimit);
      if (limit <= 0) {
        return { ok: true };
      }

      const record = state.clientTokens.find((candidate) => candidate.id === token.id);
      if (!record) {
        return { ok: true };
      }

      const id = deviceId.trim() || "unknown";
      const name = deviceName.trim() || (id === "unknown" ? "未知设备（旧版客户端）" : id);
      const now = new Date().toISOString();
      const devices = record.boundDevices ?? [];

      const existing = devices.find((device) => device.deviceId === id);
      if (existing) {
        existing.lastSeenAt = now;
        existing.name = name;
        record.boundDevices = devices;
        persist();
        return { ok: true };
      }

      if (devices.length >= limit) {
        return { ok: false, error: "device limit reached" };
      }

      record.boundDevices = [...devices, { deviceId: id, name, firstSeenAt: now, lastSeenAt: now }];
      persist();
      return { ok: true };
    },
    unbindDevice: (id, deviceId) => {
      let updated: ClientTokenRecord | undefined;
      state = {
        ...state,
        clientTokens: state.clientTokens.map((token) => {
          if (token.id !== id || token.deletedAt) {
            return token;
          }
          updated = {
            ...token,
            boundDevices: (token.boundDevices ?? []).filter(
              (device) => device.deviceId !== deviceId,
            ),
          };
          return updated;
        }),
      };
      if (updated) {
        persist();
      }
      return updated;
    },
    recordUsage: (token, counters) => {
      const day = new Date().toISOString().slice(0, 10);
      const existing = state.usageDaily.find((record) => {
        return record.tokenId === token.id && record.day === day;
      });

      if (existing) {
        addCounters(existing, counters);
      } else {
        state.usageDaily.push({ tokenId: token.id, day, ...sanitizeCounters(counters) });
      }
      persist();
    },
    getDashboard: () => {
      const byToken = new Map<string, UsageCounters>();
      let totals = { ...zeroCounters };

      for (const record of state.usageDaily) {
        totals = sumCounters(totals, record);
        byToken.set(record.tokenId, sumCounters(byToken.get(record.tokenId), record));
      }

      const tokens = state.clientTokens
        .filter((token) => !token.deletedAt)
        .map((token) => ({ ...token, ...sumCounters(byToken.get(token.id)) }))
        .sort((a, b) => b.totalTokens - a.totalTokens);

      return { totals, tokens };
    },
  };
}

export function mergeRedactedApiKeys(input: unknown, currentConfig: RemoteConfig): RemoteConfig {
  const raw = input as { providers?: Array<{ id?: string; apiKey?: string }> };
  if (raw?.providers) {
    for (const provider of raw.providers) {
      if (provider.apiKey === "********" && provider.id) {
        const existing = currentConfig.providers.find((candidate) => candidate.id === provider.id);
        if (existing) {
          provider.apiKey = existing.apiKey;
        }
      }
    }
  }

  return parseRemoteConfig(input);
}

function loadState(dataPath: string | undefined, defaultConfig: RemoteConfig): AdminState {
  if (!dataPath) {
    return emptyState(defaultConfig);
  }

  try {
    const parsed = JSON.parse(readFileSync(dataPath, "utf8")) as Partial<AdminState>;
    if (parsed.schemaVersion === 1 && parsed.config) {
      return {
        schemaVersion: 1,
        config: parseRemoteConfig(parsed.config),
        clientTokens: Array.isArray(parsed.clientTokens) ? parsed.clientTokens.map(normalizeToken) : [],
        usageDaily: Array.isArray(parsed.usageDaily) ? parsed.usageDaily : [],
      };
    }

    return emptyState(parseRemoteConfig(parsed));
  } catch {
    return emptyState(defaultConfig);
  }
}

function normalizeToken(input: ClientTokenRecord): ClientTokenRecord {
  return {
    ...input,
    tokenValue: input.tokenValue ?? input.tokenPreview ?? "",
    allowedRouteIds: normalizeAllowedRouteIds(input.allowedRouteIds),
    deviceLimit: normalizeDeviceLimit(input.deviceLimit),
    boundDevices: Array.isArray(input.boundDevices) ? input.boundDevices : [],
  };
}

function saveState(dataPath: string | undefined, state: AdminState): void {
  if (!dataPath) {
    return;
  }

  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function emptyState(config: RemoteConfig): AdminState {
  return {
    schemaVersion: 1,
    config,
    clientTokens: [],
    usageDaily: [],
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function previewToken(token: string): string {
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function normalizeAllowedRouteIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return [
    ...new Set(
      input
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  ];
}

function normalizeDeviceLimit(input: unknown): number {
  return typeof input === "number" && Number.isInteger(input) && input > 0 ? input : 0;
}

function sanitizeCounters(input: Partial<UsageCounters>): UsageCounters {
  return {
    inputTokens: nonNegativeInt(input.inputTokens),
    outputTokens: nonNegativeInt(input.outputTokens),
    cachedInputTokens: nonNegativeInt(input.cachedInputTokens),
    totalTokens: nonNegativeInt(input.totalTokens),
    requestCount: nonNegativeInt(input.requestCount),
    successCount: nonNegativeInt(input.successCount),
    failureCount: nonNegativeInt(input.failureCount),
  };
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function addCounters(target: UsageCounters, input: UsageCounters): void {
  const sanitized = sanitizeCounters(input);
  target.inputTokens += sanitized.inputTokens;
  target.outputTokens += sanitized.outputTokens;
  target.cachedInputTokens += sanitized.cachedInputTokens;
  target.totalTokens += sanitized.totalTokens;
  target.requestCount += sanitized.requestCount;
  target.successCount += sanitized.successCount;
  target.failureCount += sanitized.failureCount;
}

function sumCounters(left: Partial<UsageCounters> = {}, right: Partial<UsageCounters> = {}) {
  return {
    inputTokens: nonNegativeInt(left.inputTokens) + nonNegativeInt(right.inputTokens),
    outputTokens: nonNegativeInt(left.outputTokens) + nonNegativeInt(right.outputTokens),
    cachedInputTokens:
      nonNegativeInt(left.cachedInputTokens) + nonNegativeInt(right.cachedInputTokens),
    totalTokens: nonNegativeInt(left.totalTokens) + nonNegativeInt(right.totalTokens),
    requestCount: nonNegativeInt(left.requestCount) + nonNegativeInt(right.requestCount),
    successCount: nonNegativeInt(left.successCount) + nonNegativeInt(right.successCount),
    failureCount: nonNegativeInt(left.failureCount) + nonNegativeInt(right.failureCount),
  };
}
