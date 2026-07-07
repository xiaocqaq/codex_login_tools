# Desktop App Design

## Goal

Build a Windows desktop companion for Codex Login Tools so non-programmer users can start the local gateway, keep Codex configured, see health/status, and receive app updates without touching terminal commands.

## Scope

- Add an Electron desktop app under `apps/desktop`.
- Reuse the existing gateway server factory instead of running a separate Node script.
- Store local desktop settings on the user's machine.
- Support Windows packaging through `electron-builder`.
- Support GitHub Releases auto-update through `electron-updater`.
- Keep remote provider configuration in the existing admin service.

## Non-Goals

- Do not replace the existing admin web service.
- Do not implement a cloud relay.
- Do not convert Chat Completions providers into Responses providers.
- Do not claim published auto-updates work until a signed release and update feed exist.

## Architecture

The Electron main process owns the gateway lifecycle. It reads local desktop settings, creates the Fastify gateway with `buildGatewayServer`, starts or stops listening on `127.0.0.1:17861`, and writes the Codex config when requested. The renderer is a local HTML interface that talks to the main process through a small preload IPC API.

```text
Renderer UI
  -> preload API
  -> Electron main process
  -> GatewayController
  -> buildGatewayServer()
  -> remote admin config
  -> upstream provider
```

## Components

- `settings-store`: Reads and writes local settings JSON. It never stores upstream API keys; it stores only `configUrl`, `clientToken`, local port, model alias, and auto-start preferences.
- `GatewayController`: Starts/stops the local gateway, refreshes remote config, writes Codex config, and reports status.
- `updater`: Wraps `electron-updater` so update behavior is isolated and can be disabled in dev/test.
- `main`: Creates the BrowserWindow, tray, IPC handlers, auto-start behavior, and update wiring.
- `preload`: Exposes only the desktop API needed by the renderer.
- `renderer`: Implements the local control panel UI.

## Data Flow

1. User opens the desktop app.
2. The app loads local settings from disk.
3. If `startOnLaunch` is enabled, the main process starts the gateway.
4. The gateway fetches remote config from `CONFIG_URL` using `CLIENT_TOKEN`.
5. When Codex calls `http://127.0.0.1:17861/v1/responses`, the gateway rewrites `Authorization` and `model`, then streams the upstream response back to Codex.
6. The renderer periodically asks for status and displays current state.

## Error Handling

- Invalid local settings fall back to safe defaults.
- Gateway start failure is reported in status and does not crash the app.
- Remote config refresh failures are visible in status.
- Auto-update errors are surfaced as update status, not fatal errors.
- The app binds to `127.0.0.1` by default to avoid exposing the gateway on LAN.

## UX Direction

This is an operational desktop utility, so the UI should be quiet, dense, and clear. The first screen is the control panel, not a landing page. Use restrained surfaces, clear status lights, icon buttons with labels where useful, and no marketing copy.

Core sections:

- Gateway status and start/stop control.
- Remote config fields: server config URL and client token.
- Codex config fields: model alias, provider id, port.
- Actions: save settings, refresh remote config, write Codex config, check updates.
- Update status.

## Packaging And Updates

- Build with `electron-builder`.
- Windows target: NSIS installer and portable exe.
- Publish provider: GitHub Releases.
- The app can check for updates when packaged and when a GitHub release feed exists.
- Local development should not auto-download updates.

## Testing

- Unit-test settings load/save/default behavior.
- Unit-test gateway lifecycle with injected temp paths and local test servers.
- Unit-test updater wrapper with a fake updater.
- Keep Electron UI smoke testing as a follow-up because this MVP focuses on reliable desktop service behavior.
