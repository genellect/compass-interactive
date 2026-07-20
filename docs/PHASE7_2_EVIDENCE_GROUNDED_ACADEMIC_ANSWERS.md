# Phase 7.2 Evidence-Grounded Academic Reference Answers

Date: 2026-07-20
Status: locally implemented; automated local gate PASS, human and hosted gates HOLD

## 1. Objective and non-goals

Phase 7.2 lets a teacher request a short reference answer for an academically
valuable question. The answer is generated only after metadata from trusted
literature services is verified, remains hidden until teacher approval and is
shown to students as a bounded claim-to-source projection.

The Phase does not:

- answer every comment automatically;
- let a student trigger a paid call;
- let a model invent or browse for citations;
- store article PDFs, full-text corpora or retrieved abstracts;
- publish an AI draft automatically;
- add student polling, Realtime subscriptions or per-student rows;
- use Terra or automatically retry a paid provider request;
- change hosted Supabase, Cloudflare, OpenAI settings or production flags.

## 2. Requirements traceability

| Requirement | Implementation | Verification | Local status |
| --- | --- | --- | --- |
| Teacher-selected valuable question | explicit candidate/teacher selection in `AcademicAnswerControl` | component/static/E2E checks | PASS |
| Open lecture, Admin session and API PIN | Admin token plus one-time billing grant; DB lifecycle admission | Edge tests and pgTAP | PASS |
| Maximum three calls | `academic_answer_limit <= 3`, call counter consumed at admission | pgTAP and load model | PASS |
| One Batch call, Luna by default | one `/v1/responses` request, `gpt-5.6-luna`, low reasoning | Edge/static tests | PASS |
| Trusted literature lookup | fixed HTTPS NCBI E-utilities and Crossref hosts, bounded response/time | mocked Edge tests | PASS |
| No model-created identifiers | PMID comes from PubMed; DOI tuple is corroborated by Crossref | mismatch/fabrication tests | PASS |
| Primary evidence required | retracted records excluded; reviews/editorials context-only | quality and pgTAP tests | PASS |
| Prompt injection contained | question/evidence serialized as untrusted user data; no tools | Edge/static tests | PASS |
| Claim-source mapping | every answer point carries one to three verified PMID source IDs and at least one primary source | schema and quality gates | PASS |
| Insufficient evidence means no answer | pre-provider primary-evidence failure and post-provider quality failure persist no public answer | Edge and pgTAP | PASS |
| Teacher review required | first revision hidden; approve/hide/reject are audited server transitions | pgTAP and browser E2E | PASS |
| Late/closed result discarded | lifecycle-aware exact settlement separates cost from publication acceptance | race/idempotency pgTAP | PASS |
| Free cancellation before dispatch | reservation released when no provider dispatch occurred | pgTAP | PASS |
| Ambiguous provider outcome bounded | conservative reservation settlement; no automatic replay | Edge/static/pgTAP | PASS |
| Browser never receives secrets or hidden drafts | service-role Edge boundary and bounded public projection | grant/RLS/snapshot tests | PASS |
| No extra periodic student load | answer projection folds into the existing versioned snapshot/archive | load/static tests | PASS |
| Expand-first compatibility | v5/v3/v2 contracts remain; v6/v4/v3 added | clean/upgrade migration tests | PASS |
| Identifier validity 100%, reviewed support >=95% | curated deterministic 20-claim fixture | quality gate: 100% / 100% | PASS |
| Teacher literature review | representative human approval/rejection review | human action | HOLD |

## 3. Trust and data flow

1. The teacher selects a candidate or types a question and search phrase.
2. The browser requests a short-lived API-use billing grant after API PIN
   verification. The raw PIN and OpenAI key never enter application storage.
3. The Edge Function validates the Admin token, feature flag, body size,
   lecture ID and selection shape.
4. `admin_prepare_academic_answer_request` creates or replays an idempotent
   evidence-check request. No billed operation exists yet.
5. The Edge Function queries only fixed PubMed ESearch/EFetch endpoints. It
   accepts at most five MEDLINE records and excludes retracted records.
6. If a PubMed record has a DOI, the exact DOI resource at Crossref must agree
   on normalized title, year and author metadata. Contradictory records are
   removed rather than repaired by the model.
7. At least one verified primary study is required before billing admission.
8. The DB consumes the one-time grant, checks lecture/lane/budget/token/call
   limits and reserves the bounded maximum before provider traffic.
9. The Edge Function marks provider dispatch, then performs one strict-schema
   Responses API call with `store: false`, no tools and a pseudonymous safety
   identifier.
10. Deterministic post-model checks reject unknown source IDs, unsupported
    numeric statements, context-only claims and individualized medical advice.
11. Exact usage settlement runs once. A successful open-lecture result creates
    immutable source/revision rows and a hidden publication row.
12. The teacher explicitly approves, hides or rejects the draft. Only an
    approved projection enters the existing student snapshot and R2 archive.

Retrieved abstracts are transient Edge memory only. Stored evidence contains
bounded citation metadata, study/source classification, verification facts and
claim-source mapping; it does not contain the abstract or article body.

## 4. State machine and failure behavior

The request state machine is:

`evidence_checking -> insufficient_evidence`

`evidence_checking -> running -> awaiting_review -> published <-> hidden`

`evidence_checking|running -> failed|discarded|rejected`

The AI usage ledger independently moves from `running` to one terminal state
and from reserved accounting to exactly one settlement. Publication acceptance
and provider cost are deliberately separate: a result received after close is
settled but its content is discarded.

| Failure | Server result |
| --- | --- |
| Feature flag OFF or missing server configuration | fail closed before literature/provider traffic |
| Invalid Admin token, grant or actor mismatch | 401/403; no request starts |
| Closed, expired or archived lecture | DB rejects admission or discards a late result |
| No verified primary source | `insufficient_evidence`; zero OpenAI call |
| Literature timeout/oversize/redirect/content-type mismatch | bounded failure; zero OpenAI call |
| Provider 4xx known uncharged | settle actual zero usage; no automatic replay |
| Provider timeout/ambiguous network failure | conservatively settle the reserved ceiling; no automatic replay |
| Cancel before provider dispatch | cancel request and release reservation at zero |
| Cancel after dispatch | mark cancelled; later result can settle cost but cannot publish |
| Browser/Edge disappears | five-minute cron reaper handles two-minute stale operations idempotently |
| Reaper sees no dispatch | release at zero |
| Reaper sees dispatch but no usage | settle the reservation conservatively |
| Model refusal, invalid schema or weak mapping | fail operation; persist no answer |
| Duplicate completion | return the existing outcome without a second charge or rewrite |
| Hide after publication | remove from future projections while retaining immutable audit/history |

The `status` action opportunistically runs the same stale-operation reaper, so
recovery does not depend solely on cron. Lecture close and the existing Phase 2
lifecycle remain authoritative even if browser timers or background jobs stop.

## 5. Database, RLS and RPC design

New tables are `academic_answer_requests`, `lecture_academic_answers`,
`academic_answer_sources`, `academic_answer_revisions` and
`academic_answer_publications`. All have RLS enabled. Browser roles have no
direct table privileges; only the service-role Edge path can write or inspect
hidden work. Student access is a bounded JSON projection inside authenticated
snapshot/archive RPCs.

Public browser snapshot wrappers remain `SECURITY INVOKER`. Private primitives
are `SECURITY DEFINER` only where cross-table projection or lifecycle mutation
requires it; they use `search_path = ''`, schema-qualified objects, explicit
actor/lecture checks and minimum grants. Phase 0 `auth.uid()` participant
ownership is retained. Direct compatibility reads of comments and display state
were tightened so an authenticated user must belong to that lecture.

The migration adds v6 public snapshot, v2 operator snapshot, v4 immediate
archive and v3 R2 archive builders while preserving older versions. New foreign
keys, lecture/created, public-publication, source, revision, lease and unsettled
operation predicates have covering indexes. The new tables are not added to
Supabase Realtime.

## 6. AI quality, security and source policy

- Maximum sources: five.
- Fixed metadata timeout: six seconds per outbound request.
- Maximum metadata bodies: 64 KiB ESearch, 512 KiB EFetch and 128 KiB Crossref.
- Maximum transient evidence: 6,000 characters total and 1,500 per source.
- Maximum output: five points, three limitations and 1,200 output tokens.
- Every point maps to one to three verified `pmid:*` IDs.
- A review or editorial may provide context but cannot be the sole material
  support.
- Retracted records are excluded.
- The prompt explicitly treats the question and evidence as data, not
  instructions. The request exposes no web/file tool.
- Numeric claims must be traceable to supplied evidence text; otherwise the
  complete output is suppressed.
- The student view identifies the result as a teacher-confirmed reference,
  links to official PubMed records and displays limitations. It is not a
  diagnosis or individualized recommendation.

The deterministic fixture uses real PubMed identifiers and DOI tuples, but it
is a regression set rather than a clinical validity certification. Release
still requires a teacher to review representative Japanese and English output,
unsupported questions, conflicting literature and reject/hide behavior.

## 7. Cost and load controls

The 2026-07-20 code snapshot uses Luna token rates of USD 1 per million input
tokens and USD 6 per million output tokens. Prices are versioned constants and
must be rechecked against official OpenAI pricing before hosted enablement.

Reservation is bounded to 4,000-24,000 input tokens and 1,200 output tokens.
At the maximum, one call reserves USD 0.0312 and three calls reserve USD
0.0936 per lecture. Actual provider usage replaces the reservation exactly
once; it is never added to it. There is no automatic Terra escalation,
provider retry or answer generation from every comment.

For both 20-person Free and 300-person Pro models, Phase 7.2 adds zero periodic
student requests and zero Realtime subscriptions. At most three published
answers are included in the existing five-second snapshot and closed archive.
Literature and OpenAI calls depend on teacher actions, not participant count.

## 8. UX behavior

Admin shows candidate/manual selection, the three-call ceiling, expected cost,
API PIN action, progress/cancel state, hidden drafts, verified sources and
approve/hide/reject actions. Technical failure detail is reduced to actionable
teacher language; a weak result may simply produce no answer.

Students see the panel only when at least one teacher-confirmed answer exists.
It sits after lecture/material highlights and before exit, so it supplements
the lecture rather than displacing the PDF, captions or class discussion. Demo
uses a fixed local verified-source fixture and makes no Supabase, literature or
OpenAI request.

## 9. Migration, deployment and rollback

The migration is expand-first. It adds nullable/defaulted ledger audit fields,
new tables/indexes/functions and versioned snapshot/archive RPCs. Historical
terminal ledger rows are marked `legacy_reserved` and already settled without
rewriting their recorded cost. Clean migration and Phase 7.1-data upgrade are
both test gates.

When production is separately authorized, apply in this order:

1. record backup, owner, window, stop thresholds and rollback decision;
2. apply the migration with both Phase 7.2 flags OFF;
3. run Advisor, schema lint, historical-accounting and two-user RLS checks;
4. deploy Edge and Worker capability with server flag OFF;
5. configure the literature contact value and confirm secrets by presence only;
6. deploy frontend with client flag OFF and verify old v5/v3/v2 clients;
7. enable server then client for one teacher-controlled canary;
8. review costs, source validity, publication visibility and close/cancel races;
9. record human and hosted evidence before normal activation.

Rollback disables client and server flags first, cancels new starts and restores
the prior frontend/Edge/Worker versions. Old RPCs remain usable and additive DB
objects remain dormant. Tables or audit columns must not be dropped in the same
release; physical removal requires a later contract migration and retention
decision.

## 10. Gate boundary

Automated local PASS proves deterministic code, schema, browser, load and
fixture behavior only. It does not prove live PubMed/Crossref availability,
OpenAI production entitlement, real paid answer quality, hosted RLS/Advisor or
teacher acceptance. Those items remain Human/Hosted HOLD and block Phase 7
production enablement.
