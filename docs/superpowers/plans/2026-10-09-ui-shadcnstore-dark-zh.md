# Chinese Dark Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved ShadcnStore-inspired UI with default dark theme, Chinese copy, PC/mobile responsiveness, and publish to existing moyaiwork.com.

**Architecture:** Replace the visual shell and theme tokens while reusing all existing functional pages, data/store APIs and Cloudflare backend. Extract safe theme behavior into a small pure module; put the redesign into one clearly scoped CSS file instead of layering an unbounded override pile over minified legacy styles.

**Tech Stack:** Existing React 19, Vite, TypeScript, Tailwind, Radix, Lucide, Recharts; no new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-10-09-ui-shadcnstore-dark-zh-design.md

## Global Constraints

- Default theme is dark on the first visit, including authentication/loading screens; explicit stored light remains light.
- Use simplified Chinese for all app-owned display copy; keep product/model/API identifiers and user content intact.
- Existing workbench-theme storage key; invalid values resolve dark; denied storage never prevents app use.
- Existing backend, schema, secrets, auth, API routes, import/backup and sync logic remain unchanged.
- Fully usable dark/light layouts at 320/390/768/1440px; no document overflow; local table scrolling allowed.
- All UI styling/resources are local; no new runtime dependencies, webfont/image CDN, paid template code.
- Preserve actual data, uncertainty, consent safeguards and unsent-draft boundaries.
- Preserve borrowed MIT copyright/license and document upstream visual reference.

### Task 1: Redesign all existing UI surfaces and theme behavior

**Files:**
- Create: src/lib/theme.ts, src/lib/theme.test.ts, src/workbench.css, docs/UI-DESIGN.md.
- Modify: src/App.tsx, src/main.tsx, src/styles.css, index.html, src/pages/overview.tsx, src/pages/quota.tsx, src/pages/study.tsx, src/pages/tasks.tsx, src/pages/demands.tsx, src/pages/settings.tsx, src/components/common.tsx, src/components/quota-card.tsx as needed for the approved appearance/copy.
- Additional files only when a directly related local style/accessible shell component extraction needs one; document its purpose.

**Interfaces:**
- Consume existing useWorkbench() store exactly; no server or record contract changes.
- Produce theme helpers initializeTheme(), readTheme(), applyTheme(theme), or equivalent clearly typed functions. applyTheme applies class, color-scheme and theme-color metadata, and attempts safe persistence. Initialization precedes React rendering.
- Produce shared CSS covering every existing page and legacy class contract; remove old overlapping style blocks instead of leaving two full themes.

- [ ] Step 1: Write observable theme tests before implementation. Literal acceptance cases:
```ts
// Tests target real theme module, not source text or mocked component structure.
// Existing dependency setup uses Vitest/node; supply minimal document/storage boundary fixtures.
// A missing user preference results in dark DOM and dark color-scheme.
// A persisted light preference initializes light, never dark.
// Unsupported stored values fall back to dark.
// Reading denied storage does not throw and initializes dark.
// Applying light updates DOM/metadata and storage; a new initialization retains light.
// Writing denied storage still updates the visible theme without throwing.
```
Run `npm run test:ui -- src/lib/theme.test.ts`; record expected failure before implementation.
- [ ] Step 2: Implement minimal safe theme helpers and wire them before render. Remove shell-only theme initialization so auth/startup are themed too; keep theme switch accessible. Re-run focused tests and record pass.
- [ ] Step 3: Implement approved design. Use a balanced ShadcnStore-like shell (near-black surface, thin border, restrained blue/violet accent, inset dashboard, desktop collapsible sidebar, mobile drawer), readable typography, compact useful overview hero, consistent cards/forms/tables/modals/AI composer. Ensure desktop collapse and mobile dismissal actually work, nav aria-current/aria-expanded states meaningful. Use existing APIs; keep business handlers intact.
- [ ] Step 4: Replace English decorative labels with useful Chinese, including auth/story, page eyebrows, shell search shortcut, footer and token unit display. Do not translate product/model identifiers or user-entered data. Update HTML theme metadata/description, preserve zh-CN. Record template reference and license (MIT retained for copied snippets) in docs/UI-DESIGN.md.
- [ ] Step 5: Self-review consent/deletion/AI/backup/theme behavior, run `npm run test:ui`, `npm run build`, `git diff --check`. Commit source/docs only on ui/shadcnstore-dark-zh; no secrets/generated build files. Write full report with red/green evidence, changed files, test counts and cautions.

### Task 2: Visual acceptance, review, package and existing production deployment

**Files:** controller-owned .cache verification helpers (ignored); output screenshots/verification receipt; no new business code.

**Interfaces:** consume Task 1 build and actual app #demo with existing synthetic data; produce verified screenshots and exact published commit evidence.

- [ ] Step 1: Review Task 1 against spec and quality using its diff/report. Any Important findings return to original implementer and get scoped re-review.
- [ ] Step 2: Run preview on loopback 4445, capture real application screenshot. Check default dark auth and demo, reload light persistence, desktop collapse, mobile drawer navigation/dismissal, forms/modals, quota/study/tasks/demands/settings. Measure document width at 320/390/768/1440px via permitted browser DOM API; label sample data. Do not call paid AI or touch real user records. Correct concrete failures through implementer.
- [ ] Step 3: Final whole-branch review; ensure unchanged backend/data paths, clean source diff and test/build evidence. Generate source-only ZIP from tracked files (no env/database/key/node_modules/cache/dist), include update guide.
- [ ] Step 4: Fast-forward local main after review; push existing origin main (already authorized). If credential store blocks push, give user the concrete ready-to-push command only after all previous work is done.
- [ ] Step 5: Read public exact-SHA Cloudflare Pages check; verify /health, /api/auth/status, HTML and exact new entry assets/Chinese theme initialization. Record any real limitations and give screenshots/new site link to user. Do not claim production sign-in or paid AI tests without actually doing them.
