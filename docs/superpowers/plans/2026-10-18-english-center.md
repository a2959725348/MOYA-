# English Study Center Implementation Plan

> **For agentic workers:** Use subagent-driven-development for implementation and independent review. The user approved the local interactive preview and explicitly requested production deployment.

**Goal:** Integrate the approved English learning preview into the existing study center and deploy to moyaiwork.com.

**Architecture:** Native React UI within the current app shell, preserving the existing study assistant/plans/mistakes behind a clear secondary entry. Authenticated dedicated English endpoints use existing KV storage on SQLite/D1, server-side FSRS scheduling, revisions and idempotent actions. No database schema migration or paid API call is required.

**Tech Stack:** React 19, TypeScript, Vite, ts-fsrs 5.4.2, Zod, Fastify and Cloudflare Pages Functions/D1.

**Spec:** Approved `outputs/english-study-preview-20261018/index.html`, README.md and this session's user instruction to integrate and deploy.

## Global Constraints

- Preserve existing login, secrets, AI assistant, plans, timer, mistakes and other workbench areas.
- Provide today / words / reading / dictation / review views, PC and mobile, existing dark/light themes.
- Include 12 original vocabulary entries, one original article and three synthesized example sentences; label introductory materials accurately.
- No fake initial learning records or automatic import from the prototype's localStorage.
- New practice records are authenticated account data stored on the server; no local-only success claims.
- Server computes spelling checks, word-level dictation alignment and real FSRS schedules. No browser-controlled FSRS state.
- Writes require expectedRevision plus eventId; stale writes fail with 409; identical retries cannot double-count.
- No direct transplantation of GPL code or copied third-party wordbooks/audio.
- User has authorized publishing to the existing production site and GitHub automatic-deployment branch.

## Shared API contract

`shared/english-data.mjs` exports `englishWords`, `englishArticle`, `englishSentences`; matching declaration file provides TS types. IDs: word spelling; article `small-steps`; sentence `sentence-0` through `sentence-2`. Audio paths `/english/audio/word-<word>.wav` and `/english/audio/sentence-<i>.wav`.

GET `/api/study/english` returns `EnglishSnapshot`: `{version:1, revision:number, serverNow:string, cards:EnglishCard[], days:Record<YYYY-MM-DD,EnglishDay>, history:EnglishReviewLog[]}`.

`EnglishCard`: `{wordId:string, context:string, due:string, reps:number, state:number, intervals:Record<'1'|'2'|'3'|'4',string>}`. Intervals are ISO next-due previews from server, not formatted labels. Actual internal FSRS fields remain server-side.

`EnglishDay`: `{words:string[], articles:string[], sentences:string[]}`. Unique daily completed IDs.

`EnglishReviewLog`: `{eventId:string, wordId:string, rating:1|2|3|4, at:string, due:string}`. Bounded to latest 200.

POST `/api/study/english/actions`: common `{eventId:string, expectedRevision:number}` plus one discriminated action:
- `{kind:'collect',wordId:string,context?:string}`
- `{kind:'spell',wordId:string,answer:string}`
- `{kind:'reading',articleId:'small-steps'}`
- `{kind:'dictation',sentenceId:string,answer:string}`
- `{kind:'review',wordId:string,rating:1|2|3|4}`

Response `{snapshot:EnglishSnapshot, result:{correct?:boolean,accuracy?:number,parts?:WordDiff[],nextDue?:string}}`. `WordDiff` is `{type:'ok'|'wrong'|'missing'|'extra',expected?:string,actual?:string}`. A wrong spelling does not mutate learning counts; collect is idempotent for an existing word. A review requires server-time due status. Snapshot days use Asia/Shanghai.

## Task 1: Authenticated persisted learning engine

Files: `server/english-study.mjs`, `server/app.mjs`, `cloudflare/app.mjs`, `tests/english-study.test.mjs`.

- [ ] Write failing tests for unauthenticated/foreign-origin rejection, empty initialization, spell correctness, collect with context, reading, dictation alignment, real FSRS due times, premature review rejection, retries and revision races on both backends.
- [ ] Implement schemas, bounded state, actions and views through existing store APIs; preserve metadata and secret isolation.
- [ ] Register equivalent routes on local and edge backends; use existing D1 retry wrapper for storage-only operations.
- [ ] Add account backup support for new learning state without losing existing backup compatibility, or expose a dedicated authenticated export used by the UI; test restoration semantics if implemented.
- [ ] Run backend contract tests and obtain scoped review.

## Task 2: Approved interactive React experience

Files: `src/components/english-center.tsx`, `src/components/english-center.css`, `src/lib/english.ts`, `src/lib/english.test.ts`, `src/pages/study.tsx`.

- [ ] Test pure client helpers for date/due parsing, display and diff handling; no duplicate scheduling implementation.
- [ ] Build five views from approved prototype with scoped styles and shared canonical materials.
- [ ] Load state on entering and refresh in background without discarding typed input; serialize writes; show saved/loading/error states honestly.
- [ ] Preserve failed request eventId for safe retry; refresh on 409 and require user re-evaluation rather than silently overwriting a newer device.
- [ ] Use external lazy-loaded WAV assets; stop audio on navigation/unmount; word and sentence playback, pause/replay/rates; no autoplay before gesture.
- [ ] Keep original study features reachable; preserve existing app shell, theme, auth and routes.
- [ ] Run TypeScript/UI checks and obtain scoped review.

## Task 3: Integration, review and deployment

- [ ] Run relevant full UI/backend/edge/runtime tests and build; manually verify persisted practice flows and phone layouts through the browser.
- [ ] Independently review the complete diff, address critical/important findings, and rerun affected checks.
- [ ] Commit the reviewed implementation, fast-forward the existing main deployment branch and push. If local credentials are unavailable, attempt existing supported Cloudflare/GitHub authorization paths, then report the exact remaining manual step.
- [ ] Verify Cloudflare success against the new commit and production JS/audio/API; record receipt without credentials.
- [ ] Capture a production screenshot when authenticated access is available; otherwise report the exact verification limit.

## Execution ledger

Ruling: Work in the existing clean deployment checkout on a feature branch, without creating another worktree, because the repository and user-approved automatic deployment path are already established.

Baseline: 93 UI tests passed before changes; production base commit c76b27d.
