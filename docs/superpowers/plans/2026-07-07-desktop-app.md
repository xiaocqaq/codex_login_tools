# Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Electron Windows desktop app that controls the local Codex gateway, writes Codex config, and supports GitHub Releases auto-update.

**Architecture:** Electron main process owns gateway lifecycle and exposes a narrow IPC API to a local renderer. Existing gateway code remains the proxy implementation. Desktop-only state lives in a small JSON settings store.

**Tech Stack:** TypeScript, Electron, electron-builder, electron-updater, Fastify gateway, Vitest.

## Global Constraints

- Default local gateway host is `127.0.0.1`.
- Default local gateway port is `17861`.
- Default Codex model alias is `codex-best`.
- Upstream API keys remain managed by the remote admin service, not desktop settings.
- GitHub Releases is the default update provider.
- Do not expose destructive file operations.

---

### Task 1: Desktop Settings Store

**Files:**
- Create: `apps/desktop/src/main/settings-store.ts`
- Create: `apps/desktop/test/settings-store.test.ts`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`

**Interfaces:**
- Produces: `DesktopSettings`, `defaultDesktopSettings`, `loadDesktopSettings(path)`, `saveDesktopSettings(path, settings)`.

- [ ] Write failing tests for default settings, invalid JSON fallback, and save/load round trip.
- [ ] Run `npm run test -w @codex-login-tools/desktop` and verify failures.
- [ ] Implement settings store with JSON parsing and normalization.
- [ ] Run the desktop tests and verify they pass.

### Task 2: Gateway Controller

**Files:**
- Create: `apps/desktop/src/main/gateway-controller.ts`
- Create: `apps/desktop/test/gateway-controller.test.ts`

**Interfaces:**
- Consumes: `buildGatewayServer`, `writeCodexGatewayConfig`, `DesktopSettings`.
- Produces: `GatewayController` with `start()`, `stop()`, `refreshConfig()`, `writeCodexConfig()`, and `getStatus()`.

- [ ] Write failing tests for start/stop status and Codex config writing.
- [ ] Run the desktop tests and verify failures.
- [ ] Implement controller with injected settings provider and config path provider.
- [ ] Run desktop tests and verify they pass.

### Task 3: Update Service

**Files:**
- Create: `apps/desktop/src/main/update-service.ts`
- Create: `apps/desktop/test/update-service.test.ts`

**Interfaces:**
- Produces: `createUpdateService(updater, enabled)`.

- [ ] Write failing tests proving disabled updates do not call updater and enabled checks do.
- [ ] Implement update wrapper.
- [ ] Run desktop tests and verify they pass.

### Task 4: Electron Main, Preload, And Renderer

**Files:**
- Create: `apps/desktop/src/main/main.ts`
- Create: `apps/desktop/src/preload/preload.ts`
- Create: `apps/desktop/public/index.html`
- Create: `apps/desktop/public/styles.css`
- Create: `apps/desktop/public/renderer.js`

**Interfaces:**
- Consumes: `GatewayController`, settings store, update service.
- Produces: desktop app UI and IPC API.

- [ ] Implement BrowserWindow, tray, IPC handlers, and app lifecycle.
- [ ] Implement renderer UI for status, settings, gateway actions, Codex config writing, and update check.
- [ ] Keep renderer copy concise and operational.

### Task 5: Packaging Configuration And Docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces root scripts `dev:desktop`, `build:desktop`, `dist:desktop`.

- [ ] Add Electron dependencies and scripts.
- [ ] Configure `electron-builder` Windows targets and GitHub publish provider.
- [ ] Document development, packaging, and update release workflow.

### Task 6: Final Verification

**Files:**
- All changed files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run dist:desktop`.
- [ ] Inspect generated Windows artifacts.
- [ ] Report any verification gaps honestly.
