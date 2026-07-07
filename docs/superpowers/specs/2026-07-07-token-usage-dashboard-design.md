# Token Usage Dashboard Design

## Goal

Add first-phase token authorization, periodic usage reporting, and an admin dashboard to Codex Login Tools while keeping the current local gateway architecture.

## Decisions

- The server generates client tokens. Admin-created tokens are shown once and stored only as hashes.
- A disabled token does not stop the desktop gateway process. The gateway keeps running, but `/v1/*` requests return `403 { "error": "token disabled" }` after the next validation/config refresh detects the disabled state.
- Usage reporting is periodic. The gateway accumulates usage locally and sends aggregate counters to the admin service on an interval.
- The admin UI becomes form-based: providers, default model/route, token management, and usage dashboard are editable without writing JSON.
- The first phase stays with the local gateway. A cloud relay can be a later security upgrade.

## Architecture

```text
Admin UI
  -> admin APIs
  -> persistent admin store
     - remote config
     - hashed client tokens
     - daily usage aggregates

Desktop/Gateway
  -> Bearer client token
  -> GET /api/gateway/config for validation + config
  -> local /v1/* proxy
  -> usage accumulator
  -> POST /api/gateway/usage on interval
```

## Admin APIs

- `POST /api/admin/tokens`: create a token and return the full token once.
- `GET /api/admin/tokens`: list active/non-deleted tokens with usage totals, sortable by UI.
- `PATCH /api/admin/tokens/:id`: enable or disable a token.
- `DELETE /api/admin/tokens/:id`: soft-delete a token.
- `GET /api/admin/dashboard`: return total tokens, request counts, and token ranking.
- `GET /api/admin/config`: return redacted config.
- `PUT /api/admin/config`: save config, preserving redacted API keys.
- `GET /api/gateway/config`: validate the client token and return config.
- `POST /api/gateway/usage`: validate the client token and aggregate reported usage.

## Usage Counters

- `inputTokens`
- `outputTokens`
- `cachedInputTokens`
- `totalTokens`
- `requestCount`
- `successCount`
- `failureCount`

Usage is grouped by token and UTC day. Dashboard totals are computed from aggregates.

## Admin UI

The page should be an operational dashboard, not a JSON editor. First screen sections:

- Login row.
- Dashboard metric strip.
- Token table sorted by total usage, with enable/disable/delete actions.
- Provider form rows for `name`, `baseUrl`, `apiKey`, and enabled state.
- Default model/route form for `model alias`, `upstream model`, and route priority.

## Validation And Error Handling

- Missing or unknown token returns `401 unauthorized`.
- Disabled or deleted token returns `403 token disabled`.
- Usage report failures do not fail Codex requests. The gateway keeps counters and retries later.
- Config save rejects invalid providers/routes and keeps existing API keys when the admin UI sends the redacted placeholder.
