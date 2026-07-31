# COMPASS Interactive

COMPASS Interactive is a mobile-first classroom participation system for
Journal Clubs, pharmacy education and other COMPASS learning events. Students
join with a six-digit lecture code, follow the lecturer's PDF page, post
anonymous or optionally nicknamed comments, answer Polls and receive only the
AI learning support that has passed the configured quality and publication
gates.

This repository is independent from the COMPASS official website. The two
products can link to each other without sharing deployment cycles, databases or
secrets.

## Current status

- Application version: `0.11.0` development preview.
- Repository baseline before Phase 6.7: `cc1ae93` on `main`.
- Phase 0 through Phase 7.27 are implemented and the Phase 7.27 candidate is
  available as a temporary hosted preview. The required preview flags are
  explicitly ON, while their code defaults remain OFF. No Journal Club
  rehearsal or production run was created by the rollout. The final operational
  gate remains HOLD for the operator's hosted UX review and the tracked
  post-preview canaries.
- The Phase 0-6.5 Development Production Review deployment is recorded in
  [`docs/PRODUCTION_REVIEW_DEPLOYMENT_2026-07-16.md`](docs/PRODUCTION_REVIEW_DEPLOYMENT_2026-07-16.md).
- Phase 6.6 added the integrated teacher/student UX, approximate participant
  presence, private R2 archives, the daily operations digest and server-side
  Realtime provider shutdown. Its local evidence and remaining hosted/human
  gates are recorded separately.
- GitHub Actions now runs non-live regression, a Supabase-independent Demo E2E
  and a disposable local-Supabase teacher/student E2E.
- Phase 6.7 established the documentation/release baseline. Phase 6.8 adds
  tracked Admin sessions, PIN throttling, lecture resume tokens, CSP and
  bounded communication/provider behavior without authorizing deployment.
- Phase 6.9 preserves the public UI/data contracts while splitting internal
  Admin, state and Supabase repository responsibilities. CI now rejects DB type
  drift, mutable Action refs, high-severity dependency findings and browser or
  accessibility regressions across Chromium and WebKit.
- Phase 7.1 adds teacher-selected or source-resolved summary language, an
  ownership-safe on-demand `自分` comment history and local lecture QR on the
  selected Admin lecture and open classroom Display without extra paid calls,
  periodic requests or stored QR images.
- Phase 7.2 adds teacher-requested, verified-primary-literature reference
  drafts. PubMed metadata and exact DOI corroboration are checked before one
  bounded Luna request; unsupported or unreviewed output is never published.
- Phase 7.25 adds multidisciplinary Crossref/OpenAlex corroboration and bounded
  five-minute automatic academic-answer candidates. Low-value questions or
  candidates without a verified primary source are suppressed; visible drafts
  are labelled as not yet teacher-confirmed and remain hide/approve/edit capable.
- Phase 7.26 adds the default-OFF browser-complete private PDF publication saga.
  Ticket, Origin, bytes, magic, SHA-256, binding, expiry, nonce, immutable upload,
  hidden commit, activation and terminal cleanup are independently enforced by
  Edge, Postgres and the Cloudflare Worker. Local Publisher is recovery-only and
  must not retain an active R2 write credential while browser mode is enabled.
- Phase 7.27 adds a default-OFF `7.23 Journal Club` preparation preset for
  `Dual-targeting CasRx for C9orf72 ALS/FTD` on top of those existing contracts.
  Each production or rehearsal preparation creates a
  fresh lecture UUID, six-digit code and six draft Polls without starting the
  lecture, opening a Poll, publishing a PDF or starting paid AI work. Rehearsals
  may be repeated; exactly one production run is allowed for the preset.
- Phase 7.28 locally retires that one-off creation surface, adds an authorized
  private cross-browser Display acceleration path without adding student
  Realtime, and adds two-scope lecture-wide AI authorization while preserving a
  fresh single-use grant for every paid start. Its automated Local Gate is
  evaluated separately from Human/Hosted/Production gates; all code flags
  remain default OFF.
- The current hosted preview explicitly enables the Phase 6.8-7.27 capabilities
  for verification. This environment state does not change the default-OFF
  release contract or authorize preparation/start of a Journal Club run.
- Phase 7.28A-C has passed its automated Local Gate. Its Human UI, Hosted and
  formal Production gates remain HOLD, and no Phase 7.28 migration, flag, push
  or deployment has been applied by that local decision.

The authoritative future plan and stop-the-line gates are in
[`docs/ROADMAP.md`](docs/ROADMAP.md). Historical Phase documents remain evidence;
they must not be read as the current implementation status unless the roadmap
or a newer gate report points to them.

The temporary **Phase 7 Production Gate** hosted preview is deployed. Formal
lecture operation and creation of a Journal Club rehearsal or production run
remain blocked until the operator's hosted UX review and the remaining
authenticated Admin, R2 canary, concurrency, cleanup and device gates are
recorded.

## Implemented product surface

### Student

- anonymous Supabase Auth and lecture-code join protected by Turnstile;
- PDF-first mobile lecture view with lecturer page synchronization;
- five-second versioned snapshots with adaptive background/backoff behavior;
- latest-five comments plus on-demand cursor-paginated comment history;
- `みんな / 自分` history tabs, with own rows resolved on the server from
  `auth.uid()` and no participant-ID preference stored in the browser;
- nullable per-comment nickname, maximum ten characters, with
  `匿名の参加者` as the display fallback;
- comment likes, Poll answers, useful published summaries and captions;
- explicit exit that stops polling and pending client work;
- read-only closed-lecture archive delivered through Cloudflare rather than a
  continuing Supabase live loop.

### Teacher and classroom display

- Admin PIN session plus a separate API-use PIN for paid actions;
- lecture create/start/close/restart-as-new flows and an enforced 90-minute
  server-time hard stop;
- Poll creation, publication and closure;
- comment moderation and pinning through authorized server operations;
- default-OFF browser-to-Worker private R2 PDF publication plus a mutually
  exclusive Local Publisher recovery path, download and synchronized page
  control without storing PDF bytes in Supabase;
- explicit Realtime transcription start/stop with bounded duration and no audio
  retention by COMPASS;
- PDF material analysis and AI Poll proposals that are never automatically
  published;
- five-minute summary/comment-pulse generation with immutable revisions and
  teacher publish, hide, pin and correction controls;
- up to three evidence-grounded academic reference answers per lecture, bounded
  by API-PIN admission and primary-source verification, with teacher
  approve/hide/edit controls and an explicit unconfirmed label before review;
- approximate active-participant and visible-comment metrics folded into the
  existing snapshot path;
- scoped classroom Display sessions and a light fullscreen view.
- a locally generated six-digit lecture QR in Admin and open Display, encoding
  only the canonical same-origin join URL.
- `auto / 日本語 / English` five-minute summary language control; automatic
  resolution uses teacher transcript first and current PDF text second.

## Routes

| Route               | Purpose                               | Backend behavior                                             |
| ------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `/join`             | Live-code and archive-code entry      | Supabase live join or Cloudflare archive lookup              |
| `/demo`             | Redirect to the isolated Demo lecture | Browser-only data; no Supabase, OpenAI or Cloudflare request |
| `/lecture`          | Student lecture experience            | Authenticated five-second snapshot while joined              |
| `/lecture/comments` | On-demand comment history             | Cursor RPC only while the page is opened                     |
| `/lecture/archive`  | Read-only closed lecture              | Short-lived Cloudflare archive/PDF access                    |
| `/admin`            | Teacher controls                      | Admin Edge Functions; browser PDF publication when enabled   |
| `/display`          | Classroom fullscreen display          | Scoped Display credential, not an Admin session              |

The production build creates static entrypoints for every route so Cloudflare
Pages does not depend on a catch-all redirect.

## Architecture boundaries

- **React/Vite:** presentation, optimistic UX, local Demo and bounded local
  state. The browser is never an authorization authority.
- **Supabase Auth/Postgres/Edge Functions:** participant ownership, RLS,
  lifecycle, versioned snapshots, audit, AI admission and small metadata.
- **Browser PDF publisher (Phase 7.26, default OFF):** bounded Web Worker
  validation and direct streaming to the Cloudflare asset Worker. Supabase
  stores authorization/lifecycle metadata only, never PDF bytes or extracted
  text.
- **Local Publisher:** offline compatibility and recovery mode for PDF
  publication and teacher-controlled AI extraction. Publisher credentials
  remain local and its R2 writer is disabled while browser publication is ON;
  the two publication modes never write concurrently.
- **Cloudflare Worker/R2:** byte-level ticket/origin/size/magic/SHA/replay
  enforcement, immutable private PDF storage, scoped delivery and sanitized
  read-only archives. PDF bytes and archive download traffic do not pass
  through Supabase.
- **Journal Club preset (Phase 7.27, default OFF):** Admin preparation creates
  isolated rehearsal or production lecture records through the existing Edge
  and Postgres boundaries. The approved PDF is bound by document ID, SHA-256,
  byte count and page count; the preset stores no PDF bytes and triggers no AI.
  Only the exact production archive policy receives the permanent R2 retention
  exception; normal lectures and rehearsals retain the standard 30-day policy.
  Prepared runs enter the conventional lecture list and use its existing start
  control; both run kinds share the same PDF-gated lifecycle path.
- **Phase 7.28 operational layer (default OFF):** one-off preset creation is
  recovery-only; one claimed Display identity per lecture may receive private
  page/caption acceleration while students stay on five-second snapshots; AI
  master authorization never performs paid work and only mints short-lived
  child grants for explicit feature starts. Runtime rollback to snapshot/PDF
  remains server-authoritative and rechecks the issuing Admin session on every
  request.
- **OpenAI:** only explicitly authorized, bounded text/audio needed by the
  selected feature. The API key remains in Supabase Edge secrets.
- **Email provider:** one content-bounded daily operations digest when activity
  occurred; it does not call AI.

See [`docs/architecture.md`](docs/architecture.md),
[`docs/SECURITY.md`](docs/SECURITY.md) and
[`docs/data_policy.md`](docs/data_policy.md) for the complete trust and data
boundaries.

## Local requirements

- Node.js `>=22.22.0` (`.node-version` and CI use `22.22.0`; Node 24 is also
  supported)
- npm using the committed `package-lock.json`
- Docker Desktop with the WSL2 per-user backend for local Supabase integration
- Supabase CLI and Wrangler from this repository's pinned dev dependencies

Install dependencies:

```bash
npm ci
```

Start the frontend:

```bash
npm run dev
```

The app can start without Supabase variables and will fail closed for hosted
features. Use `/demo` for the no-backend product preview.

## Environment files and secrets

Copy only the example that matches the process you are starting:

- `.env.local.example` → `.env.local` for the Vite frontend and local Edge
  preparation;
- `.env.publisher.example` → `.env.publisher.local` for the local Publisher;
- `cloudflare/asset-worker/.dev.vars.example` for local Worker development.

All real `*.local` environment files are ignored. Example files contain names
and placeholders only.

Browser-safe values use the `VITE_` prefix. Never use that prefix for an Admin
PIN, API-use PIN, OpenAI key, Supabase service-role key, Turnstile secret, R2
credential, archive ingest secret or email-provider key.

The frontend feature flags are additive and fail closed:

- `VITE_PHASE1_SYNC_PROTOCOL`
- `VITE_PHASE2_LECTURE_LIFECYCLE`
- `VITE_PHASE3_PRIVATE_PDF`
- `VITE_PHASE4_REALTIME_CAPTIONS`
- `VITE_PHASE5_MATERIAL_ANALYSIS`
- `VITE_PHASE6_SUMMARIES`
- `VITE_PHASE6_5_COMMENT_NICKNAMES`
- `VITE_PHASE6_6_UX_INTEGRATION`
- `VITE_PHASE6_8_SECURITY`
- `VITE_PHASE7_1_CLASSROOM_EXTENSIONS`
- `VITE_PHASE7_2_ACADEMIC_ANSWERS`
- `VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS`
- `VITE_PHASE7_26_BROWSER_PDF_PUBLISHING`
- `VITE_PHASE7_27_JOURNAL_CLUB`
- `VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION`
- `VITE_PHASE7_28_DISPLAY_REALTIME`
- `VITE_PHASE7_28_AI_MASTER_AUTH`

Do not enable a flag merely because the frontend contains the code. The
matching migration, Edge Function, Worker binding, secret, ownership test and
rollback gate must pass first.

## Verification

Fast local quality checks:

```bash
npm run typecheck
npm run typecheck:phase3
npm run typecheck:e2e
npm run lint
npm run test:phase6-7-docs
npm run test:phase6-8-static
npm run test:phase7-1-edge
npm run test:phase7-1-static
npm run test:phase7-2-edge
npm run test:phase7-2-static
npm run test:phase7-2-quality
npm run test:phase7-25-edge
npm run test:phase7-25-static
npm run test:phase7-25-load
npm run test:phase7-26-browser-pdf
npm run test:phase7-26-edge
npm run test:phase7-26-static
npm run test:phase7-26-load
npm run test:phase7-27-edge
npm run test:phase7-27-static
npm run test:phase7-27-load
npm run test:phase7-28b-display-realtime
npm run test:phase7-28b-lock-order
npm run test:phase7-28c-ai-master
npm run test:phase7-28c-ai-concurrency
npm run test:phase7-28-upgrade
npm run test:phase7-28-load
npm run build
git diff --check
```

Phase 7.27/7.28 completion additionally requires their populated upgrade and
two-connection concurrency probes, complete pgTAP, and the applicable
flag-ON/OFF plus local Chromium/WebKit/Mobile E2E modes. See the dated Local
Gate record for exact counts; local PASS never waives Human or Hosted evidence.

Run every non-live regression group used by CI:

```bash
npm run test:ci:nonlive
```

Generate or verify the deterministic public Supabase database types after a
clean local migration reset:

```bash
npm run db:types:generate
npm run db:types:check
```

Run the Supabase-independent Demo browser E2E:

```bash
npm run test:e2e:demo
```

The Phase 6.9 stability gate runs the same Demo browser contracts three times
across Desktop/Mobile Chromium and WebKit:

```bash
npm run test:e2e:demo:triple
```

With Docker Desktop running, the local integration sequence is:

```bash
npx supabase start
npx supabase db reset --local --no-seed
npx supabase test db --local
npx supabase db lint --local --fail-on error
```

Serve Edge Functions with synthetic local secrets in one terminal, then run:

```bash
npm run test:e2e:local
```

The corresponding local-Supabase Chromium/WebKit stability gate is:

```bash
npm run test:e2e:local:triple
```

Detailed setup and safety constraints are in
[`docs/CI_AND_BROWSER_E2E.md`](docs/CI_AND_BROWSER_E2E.md) and
[`docs/supabase_setup.md`](docs/supabase_setup.md).

The default CI must never run live OpenAI tests, deploy, link or push a hosted
database, upload to R2, or use production credentials.

## Deployment

Deployment is a separate, explicitly authorized operation. Documentation work,
a successful local gate or a successful CI run does not authorize it.

Use the current runbook index:

- [`docs/RUNBOOK_INDEX.md`](docs/RUNBOOK_INDEX.md)
- [`docs/cloudflare_pages_deploy.md`](docs/cloudflare_pages_deploy.md)
- [`docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md`](docs/PRODUCTION_ROLLOUT_RUNBOOK_PHASE6_6.md)
- [`docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`](docs/PHASE7_PRODUCTION_GATE_2026-07-21.md)

Always deploy expand-first: database and server capability, frontend with flags
OFF, ownership and hosted smoke tests, then a controlled flag canary. Disable
flags before attempting a destructive rollback.

## Documentation map

- Current architecture: [`docs/architecture.md`](docs/architecture.md)
- Security contract and known gaps: [`docs/SECURITY.md`](docs/SECURITY.md)
- Data collection and retention: [`docs/data_policy.md`](docs/data_policy.md)
- Database responsibility map: [`docs/database_schema.md`](docs/database_schema.md)
- Development history: [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- Phase 6.7 baseline and acceptance: [`docs/PHASE6_7_DOCUMENTATION_BASELINE.md`](docs/PHASE6_7_DOCUMENTATION_BASELINE.md)
- Phase 6.7 local evidence: [`docs/PHASE6_7_LOCAL_GATE_2026-07-18.md`](docs/PHASE6_7_LOCAL_GATE_2026-07-18.md)
- Phase 6.8 security/session design: [`docs/PHASE6_8_SECURITY_SESSIONS_TIMEOUTS.md`](docs/PHASE6_8_SECURITY_SESSIONS_TIMEOUTS.md)
- Phase 6.8 local evidence: [`docs/PHASE6_8_LOCAL_GATE_2026-07-18.md`](docs/PHASE6_8_LOCAL_GATE_2026-07-18.md)
- Phase 6.9 modularization and CI design: [`docs/PHASE6_9_MODULARIZATION_AND_CI.md`](docs/PHASE6_9_MODULARIZATION_AND_CI.md)
- Phase 6.9 local evidence: [`docs/PHASE6_9_LOCAL_GATE_2026-07-19.md`](docs/PHASE6_9_LOCAL_GATE_2026-07-19.md)
- Phase 7.1 classroom UX design: [`docs/PHASE7_1_CLASSROOM_UX_EXTENSIONS.md`](docs/PHASE7_1_CLASSROOM_UX_EXTENSIONS.md)
- Phase 7.1 local evidence: [`docs/PHASE7_1_LOCAL_GATE_2026-07-19.md`](docs/PHASE7_1_LOCAL_GATE_2026-07-19.md)
- Phase 7.2 evidence-grounded answer design: [`docs/PHASE7_2_EVIDENCE_GROUNDED_ACADEMIC_ANSWERS.md`](docs/PHASE7_2_EVIDENCE_GROUNDED_ACADEMIC_ANSWERS.md)
- Phase 7.2 local evidence: [`docs/PHASE7_2_LOCAL_GATE_2026-07-20.md`](docs/PHASE7_2_LOCAL_GATE_2026-07-20.md)
- Phase 7.2 safe-stop handoff: [`docs/PHASE7_2_HANDOFF_2026-07-20.md`](docs/PHASE7_2_HANDOFF_2026-07-20.md)
- Phase 7.26 requirements and threat model: [`docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md`](docs/PHASE7_26_REQUIREMENTS_AND_THREAT_MODEL.md)
- Phase 7.26 browser PDF design: [`docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md`](docs/PHASE7_26_BROWSER_PDF_PUBLICATION.md)
- Phase 7.26 local evidence: [`docs/PHASE7_26_LOCAL_GATE_2026-07-21.md`](docs/PHASE7_26_LOCAL_GATE_2026-07-21.md)
- Phase 7.27 Journal Club integration: [`docs/PHASE7_27_JOURNAL_CLUB_INTEGRATION.md`](docs/PHASE7_27_JOURNAL_CLUB_INTEGRATION.md)
- Phase 7.27 temporary preview and remaining operational gates: [`docs/PHASE7_27_PRODUCTION_GATE_2026-07-22.md`](docs/PHASE7_27_PRODUCTION_GATE_2026-07-22.md)
- Phase 7.27 temporary preview stop and resume handoff: [`docs/PHASE7_27_TEMPORARY_PREVIEW_HANDOFF_2026-07-22.md`](docs/PHASE7_27_TEMPORARY_PREVIEW_HANDOFF_2026-07-22.md)
- Phase 7.28 requirements and threat model: [`docs/PHASE7_28_REQUIREMENTS_AND_DESIGN.md`](docs/PHASE7_28_REQUIREMENTS_AND_DESIGN.md)
- Phase 7.28 local evidence: [`docs/PHASE7_28_LOCAL_GATE_2026-07-31.md`](docs/PHASE7_28_LOCAL_GATE_2026-07-31.md)
- Phase 7 production decision: [`docs/PHASE7_PRODUCTION_GATE_2026-07-21.md`](docs/PHASE7_PRODUCTION_GATE_2026-07-21.md)
- Future phases and global gates: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Operations entrypoint: [`docs/RUNBOOK_INDEX.md`](docs/RUNBOOK_INDEX.md)
- Original detailed Phase 0-6 design decisions: [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)

## Development rule

No phase advances because implementation is merely present. A phase advances
only after its requirements traceability, database/security, code, UX/UI,
Chromium/WebKit E2E, accessibility, visual, load/cost, compatibility, rollback
and evidence gates all pass. A manual gate is blocking until a human records
the evidence; it is not an automatic exception.
