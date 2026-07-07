# Token Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-generated client tokens, periodic gateway usage reporting, and a form-based admin dashboard.

**Architecture:** Admin owns token/config/usage persistence. Gateway validates the token through config refresh, accumulates usage locally, and periodically reports aggregate counters. Admin UI uses structured forms instead of raw JSON editing.

**Tech Stack:** TypeScript, Fastify, Node crypto, JSON-backed persistent store, Vitest, plain HTML/CSS/JS.

## Global Constraints

- Disabled tokens keep the gateway process running but make `/v1/*` return `403 token disabled`.
- Usage is reported periodically, not per request.
- Full generated tokens are shown once and stored as hashes.
- Admin UI must allow editing provider `baseUrl`, `apiKey`, enabled state, and default model without editing JSON.
- No deployment until the user reviews screenshots.

---

### Task 1: Admin Persistent Store And Token APIs

**Files:**
- Create: `apps/admin/src/store.ts`
- Modify: `apps/admin/src/app.ts`
- Modify: `apps/admin/test/admin-api.test.ts`

**Interfaces:**
- Produces `AdminStore` with config, tokens, and usage aggregate methods.
- Produces admin token APIs and gateway usage API.

### Task 2: Gateway Token State And Periodic Usage Reporting

**Files:**
- Modify: `apps/gateway/src/app.ts`
- Modify: `apps/gateway/src/server.ts`
- Modify: `apps/gateway/test/gateway.test.ts`

**Interfaces:**
- Produces gateway token status and usage accumulator behavior.

### Task 3: Admin Dashboard UI

**Files:**
- Replace: `apps/admin/public/index.html`

**Interfaces:**
- Consumes existing admin APIs plus token/dashboard APIs.
- Produces dashboard, token table, provider forms, and default model form.

### Task 4: Verification And Screenshot

**Files:**
- All changed files.

**Commands:**
- `npm run test -w @codex-login-tools/admin`
- `npm run test -w @codex-login-tools/gateway`
- `npm run build`
- Start local admin and capture screenshot for review.
