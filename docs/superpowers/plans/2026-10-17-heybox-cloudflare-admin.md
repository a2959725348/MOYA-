# Heybox Cloudflare Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the simulation entry with a persistent manual administration module and publish to the user's existing Pages project.

**Architecture:** Shared server business logic works with SQLite and the existing D1Store. React reads new authenticated admin endpoints and reuses existing manual demand/AI APIs. No Python runtime or platform connection is deployed.

**Tech Stack:** React 19, TypeScript, Vite, Fastify, Cloudflare Pages Functions, D1, node:test, Vitest.

**Spec:** ../specs/2026-10-17-heybox-cloudflare-admin.md

## Global Constraints

- No platform login, automatic reading, replies, follow, private messages, or external delivery.
- Preserve current workbench login, sidebar, original demand and consultation data, secrets and DB bindings.
- No real paid AI tests or production synthetic records.
- Do not commit runtime data, credentials, node_modules or private ZIP contents.
- Work in the existing user-designated deployment checkout; user authorized replacing the prior local simulation and publishing main. Preserve unrelated edits; no worktree move or global config changes.

### Task 1: Persistent business API and parity tests

**Files:** Create server/heybox-admin.mjs and tests/heybox-admin.test.mjs; modify server/app.mjs and cloudflare/app.mjs only where routing and demand audit events require it.

**Interfaces:** Implement the exact endpoint/body/response contracts in the spec. Export shared pure schema and operations as needed. Existing store get/set/list/find/save/remove/transaction APIs are common across backends.

- [ ] Read the spec and current demand authentication, AI reservation/persistence, D1 retries.
- [ ] Write meaningful failing Node and Miniflare API tests: unauthenticated denial, foreign origin denial, no fetch on admin reads/config/reviews, config persistence/revisions, privacy/unknown fields, review edit resets, stale source approval rejected, same-tick conflicts, bounded logs.
- [ ] Verify failures using `node --test tests/heybox-admin.test.mjs`.
- [ ] Implement minimal shared operations plus both route adapters; append metadata-only audit events to existing manual demand actions.
- [ ] Verify tests and existing demand contracts without paid APIs.
- [ ] Report changed files, exact tests, red/green evidence and concerns. Do not commit until the lead collects all authorized prior changes.

### Task 2: Native admin UI and manual workflow

**Files:** Create src/components/heybox-admin.tsx, src/components/heybox-admin.css, src/lib/heybox-admin.ts and src/lib/heybox-admin.test.ts; modify src/pages/demands.tsx wrapper/export. Keep old simulation files present but unused.

**Interfaces:** Consume GET /heybox/admin, PUT /heybox/config, POST /heybox/reviews and PATCH /heybox/reviews/:id via existing api/action conventions. Exact contracts are in the spec. Use state.demands/settings and export/reuse DemandRecords for manual AI/consultation UI.

- [ ] Read the spec and completed backend report/API implementations.
- [ ] Write failing tests for keyword AND/OR/exclusions, template replacement and unknown placeholders, draft dirty-state/version handling where pure functions support it.
- [ ] Run `npm.cmd run test:ui -- src/lib/heybox-admin.test.ts` and observe red.
- [ ] Implement scoped native dark/orange admin with five tabs, persistent config, source-aware editable reviews, real metrics and metadata logs. Saved settings drive preview; no hidden paid calls.
- [ ] Run UI tests and `npm.cmd run build`; report changed files and limits.

### Task 3: Integration, review, packaging and production publish

**Files:** Add docs/HEYBOX-CLOUDFLARE-ADMIN.md and deployment/verification receipt outside source; update this progress file.

- [ ] Review Task 1 and Task 2 separately against spec; resolve security/data-loss issues and rerun affected tests.
- [ ] Run complete appropriate test suite, `npm.cmd run build`, `npm.cmd run cloudflare:build`, `git diff --check`.
- [ ] Start existing local dev server with synthetic local data, open browser, verify config save/reload, manual record, draft edit/save/approve/stale-source guard/logs, no simulated recipients, no live platform operations; check desktop/mobile widths.
- [ ] Generate a source-only ZIP excluding secrets/runtime/.git/node_modules and confirm private entries zero.
- [ ] Obtain final whole-change review; fix material findings.
- [ ] Commit approved migration and retained UI changes. Publish via existing working Cloudflare or GitHub credentials; no new secret values or schema deployment required.
- [ ] Verify deployed asset changes and read-only unauthenticated auth boundary. Clearly report if a manual push/login is the only remaining blocker, with exact command and tested artifact.
