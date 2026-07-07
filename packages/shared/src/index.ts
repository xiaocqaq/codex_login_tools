import { z } from "zod";

const providerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  enabled: z.boolean().default(true),
});

const routeSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  matchModel: z.string().min(1).default("*"),
  upstreamModel: z.string().min(1),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
});

const remoteConfigSchema = z.object({
  version: z.literal(1),
  pollIntervalSeconds: z.number().int().min(5).max(3600).default(60),
  providers: z.array(providerSchema),
  routes: z.array(routeSchema),
  defaultRouteId: z.string().min(1),
});

export type ProviderConfig = z.infer<typeof providerSchema>;
export type RouteConfig = z.infer<typeof routeSchema>;
export type RemoteConfig = z.infer<typeof remoteConfigSchema>;

export function parseRemoteConfig(input: unknown): RemoteConfig {
  const config = remoteConfigSchema.parse(input);
  const enabledProviderIds = new Set(
    config.providers.filter((provider) => provider.enabled).map((provider) => provider.id),
  );
  const enabledRouteIds = new Set(
    config.routes.filter((route) => route.enabled).map((route) => route.id),
  );

  if (!enabledRouteIds.has(config.defaultRouteId)) {
    throw new Error("defaultRouteId must reference an enabled route");
  }

  for (const route of config.routes) {
    if (route.enabled && !enabledProviderIds.has(route.providerId)) {
      throw new Error(`route ${route.id} references a missing or disabled provider`);
    }
  }

  return config;
}

export function selectRoute(config: RemoteConfig, requestedModel?: string): RouteConfig {
  return selectRouteCandidates(config, requestedModel)[0]!;
}

export function selectRouteCandidates(
  config: RemoteConfig,
  requestedModel?: string,
): RouteConfig[] {
  const enabledRoutes = config.routes.filter((route) => route.enabled);
  const matchingRoutes = enabledRoutes.filter((route) => {
    return route.matchModel === "*" || route.matchModel === requestedModel;
  });
  const candidates = matchingRoutes.length > 0 ? matchingRoutes : enabledRoutes;

  return candidates.sort((a, b) => b.priority - a.priority);
}

export function findProvider(config: RemoteConfig, providerId: string): ProviderConfig {
  const provider = config.providers.find((candidate) => candidate.id === providerId);
  if (!provider || !provider.enabled) {
    throw new Error(`provider ${providerId} is missing or disabled`);
  }

  return provider;
}
