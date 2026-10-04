# Cloudflare backend implementation plan

Goal: deploy the complete existing workbench through Pages Git integration with a D1 backend, retaining local deployment.

Architecture: Pages Fetch API routes, optimistic transactional D1 snapshot store, compatible encrypted vault, streamed AI responses. Tech stack: JavaScript, Cloudflare Pages Functions, D1 SQLite, nodejs_compat, Vite/React. Spec: ../specs/2026-10-04-cloudflare-design.md.

1. Write failing behavioral tests for D1 persistence, concurrent transactions and vault compatibility; implement cloudflare/store.mjs and vault.mjs plus migrations/0001_initial.sql. Verify real SQLite SQL behavior with tests/helpers/d1.mjs.
2. Port HTTP contracts and origin/session protection to cloudflare/app.mjs and network.mjs; implement Functions entry points. Verify authentication, settings, CRUD, backup, synchronization and upstream endpoint protection.
3. Implement cloudflare/chat.mjs with daily quota reservation and native SSE. Verify streaming boundaries, incomplete responses, usage/cost and concurrent daily limits without paid request replay.
4. Implement scripts/cloudflare-export.mjs and cloudflare-package.mjs plus docs/CLOUDFLARE.md. Verify original password/key preservation, exclusion of sessions and private files, and import into a fresh D1 schema.
5. Add Wrangler configuration, build/dev/deployment scripts, static headers and Git exclusions. Run a genuine workerd/D1 smoke test, existing regression suite and production frontend build.
6. Independently review changed backend and packaging, repair findings and rerun affected checks. Deliver source ZIP and precise GitHub/Cloudflare configuration instructions; do not claim the user's cloud deployment is already live.
