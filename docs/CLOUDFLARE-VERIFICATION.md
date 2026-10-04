# Cloudflare adaptation verification — 2026-10-04

Local evidence on Node 24.14.0, Wrangler 4.147.0 and its matching Miniflare/workerd runtime:

- `npm test`: 139 passed, zero failures (38 Node backend, 19 agent, 36 frontend, 46 Cloudflare).
- `node --test tests/windows-deploy.test.mjs`: 3 passed, zero failures. Existing Windows deployment and uncommitted agent fixes retained.
- `npm run cloudflare:build`: TypeScript/Vite production build and Pages Functions compilation succeeded with nodejs_compat.
- The actual compiled Pages Worker loaded a fresh D1 schema and a private fixture export, rejected a second nonempty import, logged in using the original scrypt hash, decrypted the original AES-GCM API setting, fetched a simulated official balance, streamed and saved a simulated AI answer and actual usage, and persisted CRUD changes. No real provider or paid API calls were made.
- Real SQLite SQL tests cover atomic guarded batch commits, simultaneous setup and record writes, rollback, stale snapshots, task deduplication, revocation during chat reservation, daily request limits, SSE truncation/cancellation, API host restrictions and redirect rejection. A large restore losing a write conflict stops within the total 50-query budget without publishing partial rows.
- Independent review findings corrected: revoked sessions entering chat reservation, older balance refresh overwriting newer results, and retry query-budget overflow. Runtime testing additionally found and corrected workerd's rejection of fetch redirect:error; the edge transport now uses manual mode and rejects every redirect response.
- Migration export preserves password hashes, configuration and matching key; drops sessions. ZIP tests verify hidden config inclusion and recursive exclusion of private exports, credentials, databases, backups and binaries. No private export was generated from the user's real database during this implementation.

Deployment is not yet published to the user's Cloudflare account. The DB UUID in wrangler.jsonc remains an intentional placeholder. A real D1 binding, imported private data, matching encrypted VAULT_KEY and exact APP_ORIGIN are required. Real provider permissions and domain DNS must be verified after deployment.

Limits: Cloudflare market sampling is request-driven; local Codex synchronization requires the signed-in computer and helper. The free Workers CPU limit may be insufficient for compatible scrypt login. No promise of zero hosting cost is made. The frontend retains its existing large-chunk build warning. npm audit reports known advisories for the existing Node-only @fastify/static dependency; Cloudflare Functions do not import Fastify/static, and this change does not upgrade the retained legacy server dependency.
