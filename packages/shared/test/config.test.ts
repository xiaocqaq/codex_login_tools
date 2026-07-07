import { describe, expect, it } from "vitest";
import { parseRemoteConfig, selectRouteCandidates } from "../src/index.js";

describe("parseRemoteConfig", () => {
  it("accepts an enabled provider and default route", () => {
    const config = parseRemoteConfig({
      version: 1,
      pollIntervalSeconds: 30,
      providers: [
        {
          id: "primary",
          name: "Primary",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          enabled: true,
        },
      ],
      routes: [
        {
          id: "default",
          providerId: "primary",
          matchModel: "*",
          upstreamModel: "gpt-5.5-compatible",
          enabled: true,
          priority: 100,
        },
      ],
      defaultRouteId: "default",
    });

    expect(config.providers[0]?.baseUrl).toBe("https://api.example.com/v1");
    expect(config.routes[0]?.upstreamModel).toBe("gpt-5.5-compatible");
  });

  it("rejects a default route that does not exist", () => {
    expect(() =>
      parseRemoteConfig({
        version: 1,
        providers: [],
        routes: [],
        defaultRouteId: "missing",
      }),
    ).toThrow("defaultRouteId must reference an enabled route");
  });
});

describe("selectRouteCandidates", () => {
  it("returns matching routes by priority before wildcard fallback routes", () => {
    const config = parseRemoteConfig({
      version: 1,
      providers: [
        {
          id: "primary",
          name: "Primary",
          baseUrl: "https://primary.example.com/v1",
          apiKey: "sk-primary",
          enabled: true,
        },
        {
          id: "backup",
          name: "Backup",
          baseUrl: "https://backup.example.com/v1",
          apiKey: "sk-backup",
          enabled: true,
        },
      ],
      routes: [
        {
          id: "wildcard",
          providerId: "backup",
          matchModel: "*",
          upstreamModel: "backup-model",
          enabled: true,
          priority: 1,
        },
        {
          id: "specific",
          providerId: "primary",
          matchModel: "codex-best",
          upstreamModel: "primary-model",
          enabled: true,
          priority: 10,
        },
      ],
      defaultRouteId: "wildcard",
    });

    expect(selectRouteCandidates(config, "codex-best").map((route) => route.id)).toEqual([
      "specific",
      "wildcard",
    ]);
  });
});
