# Codex Gateway Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Codex forwarding gateway plus a remote web admin config service.

**Architecture:** The gateway listens on `127.0.0.1:17861`, fetches provider/route config from the admin service, rewrites request auth/model, and transparently returns upstream Responses API bodies. The admin service exposes an administrator UI plus authenticated config APIs for gateways.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Vitest, npm workspaces.

## Global Constraints

- Default gateway port is `17861` to avoid ccs/cc switch collisions.
- Admin port is `18080`.
- The upstream provider must be `/v1/responses` compatible for transparent response forwarding.
- Do not persist real API keys into Codex config.

---

### Task 1: Shared Config Model

**Files:**
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/test/config.test.ts`

**Interfaces:**
- Produces: `parseRemoteConfig(input): RemoteConfig`
- Produces: `selectRoute(config, requestedModel): RouteConfig`
- Produces: `findProvider(config, providerId): ProviderConfig`

- [x] Write config parser tests for valid config and missing default route.
- [x] Implement zod schema validation and cross-reference checks.
- [x] Run `npm run test -w @codex-login-tools/shared`.

### Task 2: Remote Admin Service

**Files:**
- Create: `apps/admin/src/app.ts`
- Create: `apps/admin/src/server.ts`
- Create: `apps/admin/public/index.html`
- Test: `apps/admin/test/admin-api.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/login`
- Produces: `GET /api/admin/config`
- Produces: `PUT /api/admin/config`
- Produces: `GET /api/gateway/config`

- [x] Write API tests for client token protection and admin config save.
- [x] Implement Fastify server and static admin UI.
- [x] Run `npm run test -w @codex-login-tools/admin`.

### Task 3: Local Gateway

**Files:**
- Create: `apps/gateway/src/app.ts`
- Create: `apps/gateway/src/server.ts`
- Test: `apps/gateway/test/gateway.test.ts`

**Interfaces:**
- Produces: `buildGatewayServer(options)`
- Produces: `GET /health`
- Produces: `GET /gateway/status`
- Produces: `ALL /v1/*`

- [x] Write proxy test for config fetch, auth rewrite, model rewrite, and upstream response return.
- [x] Implement gateway server and periodic config refresh.
- [x] Run `npm run test -w @codex-login-tools/gateway`.

### Task 4: Codex Config Writer

**Files:**
- Create: `apps/gateway/src/codex-config.ts`
- Test: `apps/gateway/test/codex-config.test.ts`

**Interfaces:**
- Produces: `writeCodexGatewayConfig(options): Promise<void>`

- [x] Write test that preserves existing config and inserts a managed block.
- [x] Implement marker-based config writer.
- [x] Wire `AUTO_WRITE_CODEX_CONFIG=1` into gateway startup.

### Task 5: Docs And Deployment

**Files:**
- Create: `README.md`
- Create: `docker-compose.yml`
- Create: `apps/admin/Dockerfile`

- [x] Document local startup, remote config schema, Codex config block, verification commands.
- [x] Add Docker Compose path for admin deployment.
- [x] Run full test and build verification.

### Task 6: Route Failover

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/gateway/src/app.ts`
- Test: `packages/shared/test/config.test.ts`
- Test: `apps/gateway/test/gateway.test.ts`

**Interfaces:**
- Produces: `selectRouteCandidates(config, requestedModel): RouteConfig[]`
- Updates: gateway `/v1/*` proxy to try route candidates in priority order.

- [x] Write a shared test for route candidate ordering.
- [x] Write a gateway test for 500 failover to backup provider.
- [x] Implement retryable failure switching for network errors, HTTP 429, and HTTP 5xx.
- [x] Document multi-provider failover configuration.
