import { buildGatewayServer } from "./app.js";
import { writeCodexGatewayConfig } from "./codex-config.js";
import { join } from "node:path";

const port = Number(process.env.GATEWAY_PORT ?? "17861");
const host = process.env.GATEWAY_HOST ?? "127.0.0.1";
const configUrl = process.env.CONFIG_URL ?? "http://127.0.0.1:18080/api/gateway/config";
const usageUrl = process.env.USAGE_URL ?? configUrl.replace(/\/config$/, "/usage");
const clientToken = process.env.CLIENT_TOKEN ?? "dev-client-token";
const providerId = process.env.CODEX_PROVIDER_ID ?? "friend_gateway";
const codexModel = process.env.CODEX_MODEL ?? "codex-best";

const app = buildGatewayServer({ configUrl, usageUrl, clientToken });

try {
  await app.refreshConfig();
} catch (error) {
  console.warn(
    `Gateway started without remote config: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (process.env.AUTO_WRITE_CODEX_CONFIG === "1") {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (!home) {
    console.warn("Cannot write Codex config: HOME/USERPROFILE is missing");
  } else {
    await writeCodexGatewayConfig({
      configPath: process.env.CODEX_CONFIG_PATH ?? join(home, ".codex", "config.toml"),
      port,
      providerId,
      model: codexModel,
    });
    console.log("Codex config updated for local gateway");
  }
}

setInterval(() => {
  app.refreshConfig().catch((error) => {
    console.warn(`Config refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, Number(process.env.CONFIG_REFRESH_MS ?? "60000")).unref();

setInterval(() => {
  app.flushUsage().catch((error) => {
    console.warn(`Usage report failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, Number(process.env.USAGE_REPORT_MS ?? "60000")).unref();

await app.listen({ port, host });
console.log(`Gateway listening on http://${host}:${port}`);
