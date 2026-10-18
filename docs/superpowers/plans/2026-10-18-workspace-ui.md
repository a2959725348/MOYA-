# Workspace A＋B Implementation Plan

> **For agentic workers:** Execute inline using executing-plans; request a reviewer after implementation. The user has authorized implementation and deployment in this session.

**Goal:** Apply the approved Chinese A＋B preview to the existing production workbench using real data.

**Architecture:** Keep the existing provider, authentication, routes and API handlers. Update the React shell and overview composition; apply a final shared stylesheet and a scoped Heybox stylesheet. Preserve existing study and administrator business logic.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, Radix, Recharts; existing Pages Functions and D1.

**Spec:** `docs/superpowers/specs/2026-10-18-workspace-ui-design.md`

## Global Constraints

- Chinese default dark, existing light-mode persistence preserved.
- No production secrets, database schema or API changes.
- No sample data copied into production components.
- Do not mix currencies or confuse unknown balance with zero.
- Keep mobile dialogs, keyboard navigation, >=44px mobile controls and no page overflow at 320/390/768px.
- Work in the clean, user-designated deployment checkout; no new worktree or dependency installation needed.

### Task 1: Real-data dashboard and shell

**Files:** `src/App.tsx`, `src/pages/overview.tsx`, `src/components/quota-card.tsx`, `src/lib/workspace.ts`, `src/lib/workspace.test.ts`, `src/lib/theme.ts`.

**Interfaces:** existing `useWorkbench()` and `State`; new currency-preserving `apiBalances(accounts: Account[]): {currency:string;balance:number;count:number}[]`.

- [x] Add failing tests for missing API balances, currency separation and excluding subscriptions/percent units/nonfinite values.
- [x] Run `npm.cmd run test:ui -- src/lib/workspace.test.ts` and confirm the missing implementation fails.
- [x] Implement the helper and consume it in the fourth overview tile.
- [x] Update shell groups and mobile navigation, preserving auth/search/logout/dialog handlers.
- [x] Recompose overview around real quota, plans, trends and tasks; do not change save or API contracts.
- [x] Run the focused tests and complete UI suite.

```ts
export function apiBalances(accounts: Account[]): {currency:string;balance:number;count:number}[]
```

### Task 2: Shared visual system, study and Heybox

**Files:** `src/workspace.css`, `src/main.tsx`, `src/pages/study.tsx`, `src/components/heybox-workspace.css`, `src/components/heybox-admin.tsx` (style import only).

**Interfaces:** existing class contracts, `--primary`, `--border`, `--card`, `--foreground`, chart variables. Study view wrappers retain mounted timer state and original forms.

- [x] Add the final shared stylesheet after existing base CSS, using semantic colors and responsive grids.
- [x] Add scoped `.workspace-v2 .hba` rules so lazy-loaded old administrator CSS cannot override the design.
- [x] Update the AI view presentation while retaining all study modes and real stream/error/save actions.
- [x] Build with `npm.cmd run build`.
- [x] Start a loopback Vite preview and inspect six pages, light/dark, modal keyboard behavior and 320/390/768px layouts.
- [x] Request an independent code review; fix material findings.

### Task 3: Deploy and verify

**Files:** source-only commit, deployment receipt in `outputs/`.

- [x] Run applicable frontend and backend contract regressions; report any known local runtime limitation without claiming it passed.
- [x] Inspect `git diff --check`, changed file list and build assets.
- [ ] Commit the approved UI; push to the existing main branch without force or credential changes.
- [ ] If GitHub credential access is unavailable, check the existing Cloudflare route; use an authorized available path, otherwise provide the exact remaining push command.
- [ ] Verify GitHub SHA, Pages success and production assets; check `/health`, `/api/auth/status` and unauthenticated `/api/heybox/admin`.

```text
npm.cmd run test:ui
npm.cmd run build
git diff --check
git push origin main
```
