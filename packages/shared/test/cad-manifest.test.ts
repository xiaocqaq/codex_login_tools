import { describe, expect, it } from "vitest";
import { emptyCadManifest, parseCadManifest } from "../src/cad-manifest.js";

const validSha = "a".repeat(64);
const otherSha = "b".repeat(64);

function baseManifest() {
  return {
    version: 1 as const,
    revision: 3,
    skills: [{ id: "jikeng", name: "基坑支护CAD", ver: "1.2.0", sha256: validSha }],
    scripts: [{ id: "zhph-lsp", name: "支护剖面绘图", ver: "1.0.0", sha256: otherSha }],
    bundles: [{ id: "cad-mcp-win", name: "本地CAD控制", ver: "0.1.0", sha256: validSha }],
    mcpServers: [
      {
        name: "cad_local",
        transport: "stdio" as const,
        bundleId: "cad-mcp-win",
        disabledTools: ["run_arbitrary_python"],
      },
    ],
  };
}

describe("parseCadManifest", () => {
  it("parses a valid manifest and fills defaults", () => {
    const manifest = parseCadManifest(baseManifest());
    expect(manifest.skills[0]?.size).toBe(0);
    expect(manifest.mcpServers[0]).toMatchObject({
      transport: "stdio",
      bundleId: "cad-mcp-win",
      enabledTools: [],
    });
  });

  it("accepts an http mcp server in centralized mode", () => {
    const input = baseManifest();
    input.mcpServers.push({
      name: "cad_dxf",
      transport: "http",
      url: "https://cad.example.com/mcp",
      auth: "bearer",
    } as never);
    const manifest = parseCadManifest(input);
    expect(manifest.mcpServers).toHaveLength(2);
  });

  it("rejects a bad sha256", () => {
    const input = baseManifest();
    input.skills[0]!.sha256 = "not-a-hash";
    expect(() => parseCadManifest(input)).toThrow(/sha256/);
  });

  it("rejects a non-semver version", () => {
    const input = baseManifest();
    input.skills[0]!.ver = "1.2";
    expect(() => parseCadManifest(input)).toThrow(/semver/);
  });

  it("rejects duplicate artifact ids", () => {
    const input = baseManifest();
    input.skills.push({ id: "jikeng", name: "dup", ver: "1.0.0", sha256: otherSha });
    expect(() => parseCadManifest(input)).toThrow(/duplicate skills id/);
  });

  it("rejects duplicate mcp server names", () => {
    const input = baseManifest();
    input.mcpServers.push({
      name: "cad_local",
      transport: "stdio",
      bundleId: "cad-mcp-win",
    } as never);
    expect(() => parseCadManifest(input)).toThrow(/duplicate mcp server name/);
  });

  it("rejects a stdio server referencing a missing bundle", () => {
    const input = baseManifest();
    input.mcpServers[0]!.bundleId = "ghost-bundle";
    expect(() => parseCadManifest(input)).toThrow(/missing bundle/);
  });

  it("produces a valid empty manifest", () => {
    const manifest = emptyCadManifest();
    expect(manifest).toEqual({
      version: 1,
      revision: 0,
      skills: [],
      scripts: [],
      bundles: [],
      mcpServers: [],
    });
  });
});
