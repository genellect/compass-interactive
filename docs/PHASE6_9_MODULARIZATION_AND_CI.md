# Phase 6.9 Modularization and Deterministic CI Design

Date: 2026-07-19
Status: locally implemented; production and hosted-CI evidence HOLD

## 1. Objective and non-goals

Phase 6.9 reduces change risk in the large Admin, context and Supabase client
modules and turns the intended Phase 7 release gates into repeatable CI
contracts. It must preserve routes, visible workflows, request cadence, RPC
names, database schema and public TypeScript interfaces.

This Phase does not add a migration, change RLS or grants, enable a feature
flag, call OpenAI, change Cloudflare or Hosted Supabase, push Git, deploy the
public web or authorize Phase 7 production reflection.

## 2. Requirements traceability

| Requirement                  | Implementation                                                                                                                         | Verification                                                                   | Local status     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| Admin responsibility split   | `components/AdminWorkspace` contains auth/session, lecture, PDF, AI, Poll and moderation units; `AdminPage` retains orchestration      | static boundary gate, typecheck, production build, browser E2E                 | PASS             |
| Context responsibility split | pure session/lifecycle, snapshot, comments/Polls helpers plus `useArchiveResume`; public `CompassStateValue` unchanged                 | existing unit/static tests, archive tests, local teacher/student E2E           | PASS             |
| Repository split             | shared `transport`, request/timeout/error policy and live-state mappers; public repositories retain exports                            | characterization tests, Edge integration, typecheck and production build       | PASS             |
| Deterministic DB types       | pinned Supabase CLI generates `src/types/database.ts` from clean local `public` schema                                                 | clean reset then `db:types:check`; CI fails on drift                           | PASS             |
| Supply-chain controls        | immutable Action SHAs, minimal permissions, Dependabot, dependency review, CodeQL, secret scan, high-severity audit and CycloneDX SBOM | local static/audit/SBOM validation; hosted jobs require a committed GitHub run | PARTIAL evidence |
| Browser coverage             | Chromium and WebKit Desktop/Mobile; axe Critical/Serious gate, keyboard flow and deterministic layout snapshots                        | three consecutive Demo runs and three consecutive real local-Supabase runs     | PASS             |
| Load/cost preservation       | no new client loop, subscription, Supabase row or paid call; existing five-second adaptive snapshot remains sole loop                  | Phase 1-6.9 load tests and bundle gate                                         | PASS             |

## 3. Responsibility boundaries

### Admin

`AdminPage` owns shared state, repository orchestration and cross-panel
coordination. Child panels receive values and event callbacks; they do not gain
direct database or secret access. This keeps the previous order, labels, IDs,
disabled states and handler semantics while giving each teacher task an
independent unit.

### Classroom state

`CompassStateContext` remains the single provider and the only owner of the
adaptive live-sync loop. Extracted pure functions own merge/cursor/capability
rules. `useArchiveResume` owns only archive resume state and retry cleanup.
Student write authorization continues to reside in server RPC/RLS rather than
these client helpers.

### Supabase client

Public repository imports remain compatible. Internal mapping is separated from
network transport, and every centralized deadline preserves the Phase 6.8
fail-closed behavior. The transport wrapper accepts the Supabase SDK's native
invoke options, so timeout and abort semantics are not weakened.

## 4. Deterministic database types

The exact-pinned repository Supabase CLI is invoked directly from
`node_modules`; a globally installed CLI cannot alter output. Generation uses
the local database, `--schema public`, and normalized line endings. CI performs
a clean migration reset before comparing generated output byte-for-byte.

The type file is generated output and must not be manually edited or formatted.
Any schema change must first be expressed as an expand-first migration, applied
from zero locally, then followed by `npm run db:types:generate`.

## 5. CI and supply-chain policy

- Third-party Actions use full 40-character commit SHAs; checkout does not
  persist credentials.
- Workflow permissions default to `contents: read`; CodeQL alone receives
  `security-events: write`.
- Pull requests fail on new High/Critical dependencies. `npm audit` fails at
  High, and the high-confidence scanner covers tracked and non-ignored
  untracked files without printing secret values.
- A CycloneDX SBOM is generated on every quality run and retained as bounded CI
  evidence.
- CodeQL analyzes JavaScript/TypeScript. Dependabot proposes bounded weekly npm
  and Actions updates; it never deploys them.
- Default CI contains no live OpenAI, hosted Supabase link/push, R2 upload,
  Cloudflare deploy or public deployment command.

If a High/Critical finding cannot be fixed immediately, release remains blocked
unless an owner records a narrow, time-bounded exception with affected paths,
runtime reachability, compensating control and expiry. Phase 6.9 creates no such
exception.

## 6. Browser and visual contract

The Demo suite covers join, local comment/nickname/Poll/history/exit behavior,
zero serious axe findings, keyboard join/exit and deterministic layout data.
The latter records effective theme colors, grid areas/columns, section order and
overflow at each approved viewport without OS-dependent pixel snapshots.

The local-Supabase suite runs the existing teacher/student lecture lifecycle in
both Chromium and WebKit. Three clean repeats are required with no retry-
dependent pass. Mobile Chromium and WebKit are covered by the isolated Demo
contract, which is the mobile classroom UX baseline.

## 7. Failure behavior

| Failure                                    | Required result                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| DB type drift                              | quality job fails before browser integration                                   |
| Mutable Action ref or missing security job | Phase 6.9 static gate fails                                                    |
| High/Critical dependency or secret pattern | CI fails and does not print the value                                          |
| CodeQL/dependency-review finding           | pull request/release remains blocked                                           |
| Chromium/WebKit/a11y/visual mismatch       | browser job fails and uploads bounded trace/screenshot evidence                |
| Supabase/Edge startup failure              | local integration fails closed; no hosted fallback is permitted                |
| RPC/Edge timeout                           | existing Phase 6.8 abort/error path is used; no duplicate paid replay is added |
| Refactor regression                        | characterization, build, bundle or real local-Supabase E2E blocks the Phase    |

## 8. Migration and rollback

There is no Phase 6.9 database migration and therefore no schema rollback. The
clean reset proves compatibility with all Phase 0-6.8 migrations and the newly
generated types describe that resulting schema.

Code rollback restores the prior Admin/context/repository modules and CI files
as one commit. Database objects and production services are untouched. If the
new CI jobs are unavailable, they may be diagnosed but must not be silently
removed to release; the prior non-live and local-Supabase gates remain required.

## 9. Release boundary

The automated local implementation may be committed independently. Hosted
CodeQL/dependency-review/SBOM evidence, normal CI on the committed SHA and a
human Admin/student/Display accessibility review remain required before Phase
6.9 is considered fully release-certified. Deployment belongs only to the
future Phase 7 Production Gate.
