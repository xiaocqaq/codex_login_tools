import { buildAdminServer } from "./app.js";

const port = Number(process.env.ADMIN_PORT ?? "18080");
const host = process.env.ADMIN_HOST ?? "0.0.0.0";

const app = buildAdminServer({
  adminUser: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "change-me",
  clientToken: process.env.CLIENT_TOKEN ?? "dev-client-token",
  dataPath: process.env.ADMIN_DATA_PATH ?? "data/config.json",
});

await app.listen({ port, host });
console.log(`Admin server listening on http://${host}:${port}`);
