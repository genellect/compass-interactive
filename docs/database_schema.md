# COMPASS Interactive Database Responsibility Map

Last reviewed: 2026-08-12
Authority: `supabase/migrations/` and a clean local database generated from all
migrations

This document is a responsibility map, not a hand-maintained substitute for the
schema. Column types, constraints, functions and grants must be checked against
the migrations or generated database types before implementation.

## 1. Core lecture and participation

| Table group                                 | Responsibility                                                        |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `lecture_sessions`                          | Lecture identity, state and canonical lifecycle timestamps            |
| `participants`                              | Anonymous participant row owned by `auth.uid()` within one lecture    |
| `comments` / `comment_likes`                | Bounded comments, optional per-comment nickname and unique likes      |
| `polls` / `poll_options` / `poll_responses` | Poll definition and one owned response per participant                |
| `lecture_admin_codes`                       | Server-controlled Admin-to-lecture relationship; not student-readable |

The public API never treats a participant UUID supplied by a browser as proof
of ownership. Participant joins and writes must bind to `(select auth.uid())`.

## 2. Synchronization and display

| Table group                                  | Responsibility                                          |
| -------------------------------------------- | ------------------------------------------------------- |
| `lecture_live_state`                         | Section versions and bounded shared live projection     |
| `comment_like_totals` / `poll_option_totals` | Cached aggregates without exposing raw ownership rows   |
| `lecture_display_state`                      | Compatibility state for synchronized classroom display  |
| `lecture_participant_presence`               | Throttled, server-timestamped heartbeat per participant |
| `lecture_presence_metrics`                   | Shared approximate participant/comment counts           |

Phase 1 snapshot RPCs separate shared state from participant-specific state.
History is cursor-paginated and is not part of the periodic snapshot.
Phase 7.1 adds a participant-scoped partial history index and v3 on-demand RPC;
`mine` ownership is resolved from `auth.uid()` and does not expose a participant
identifier in the response.

`poll_result_refresh_events` is a legacy compatibility artifact. New work must
not create a new student Realtime dependency around it.

## 3. Lifecycle, archive and audit

| Table group                    | Responsibility                               |
| ------------------------------ | -------------------------------------------- |
| `lecture_lifecycle_events`     | Append-only start/close/archive audit        |
| `lecture_archive_state`        | Canonical archive access and retention state |
| `lecture_archive_exports`      | Leased, idempotent sanitized export outbox   |
| `lecture_join_rate_limits`     | Server-side lecture-code attempt control     |
| `comment_moderation_events`    | Auditable hide/restore/pin actions           |
| `daily_operations_digest_jobs` | One idempotent digest job per date/recipient |

The database uses server time for expiry. Manual and automatic close converge
on the same close core. Read/write RPCs independently reject an expired lecture
even when scheduled maintenance has not run.

## 4. PDF metadata

`lecture_pdf_documents` stores document identity, publication state, bounded
metadata, retention state and R2/manifest references. It does not store PDF
bytes or the extracted body text.

`lecture_pdf_publications` is the browser-publication saga row. It stores the
lecture/document/Admin/idempotency binding, expected hash/size, nonce/JTI
digests, operation leases, Worker receipts, manifest/access versions, terminal
cleanup state and audit timestamps. RLS is enabled, browser roles receive no
table grant/policy, and service-role-only SECURITY INVOKER RPCs perform every
transition after Edge validates the tracked Admin session.

PDF page state is synchronized through the shared lecture state. Students
download byte ranges through the Cloudflare Worker, not through Supabase.

## 5. AI control and usage

| Table group                                    | Responsibility                                                  |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `lecture_ai_control`                           | Per-lecture enable/stop state, budgets and concurrency ceilings |
| `ai_usage_ledger`                              | Reserved/final usage and cost accounting                        |
| `ai_billing_rate_limits` / `ai_billing_grants` | API-use PIN attempt and one-time start authorization            |
| `ai_realtime_token_audit`                      | Realtime secret issuance audit                                  |
| `ai_realtime_provider_calls`                   | Provider-call identity, deadline and idempotent hangup state    |
| `lecture_public_captions`                      | Bounded completed caption windows for snapshot delivery         |
| `academic_answer_requests`                     | Idempotent evidence/admission/provider-dispatch state           |
| `lecture_academic_answers`                     | Immutable answer identity, model and prompt audit               |
| `academic_answer_sources`                      | Verified bounded citation metadata; no abstract/body text       |
| `academic_answer_revisions`                    | Immutable AI/teacher answer bodies                              |
| `academic_answer_publications`                 | Hidden/public teacher-reviewed projection                       |

`lecture_ai_control.summary_language` stores the future-window preference.
Each `lecture_summary_windows` row snapshots `requested_language` and later
records `resolved_language`, reason and timestamp exactly once. These fields
contain metadata only, never source text.

Realtime and Batch use separate concurrency lanes. A failed or closed operation
must release its lane and finalize/discard through the existing idempotent
ledger path.

## 6. Material analysis, Poll proposals and summaries

| Table group                                        | Responsibility                                          |
| -------------------------------------------------- | ------------------------------------------------------- |
| `material_ai_operation_contexts`                   | Bounded operation input/evidence context                |
| `lecture_material_analyses`                        | Immutable analysis result and quality state             |
| `ai_poll_proposals`                                | Teacher-only Poll drafts; never automatic student Polls |
| `lecture_summary_runs` / `lecture_summary_windows` | Five-minute scheduling and idempotency                  |
| `lecture_ai_summaries`                             | Logical summary output                                  |
| `lecture_ai_summary_revisions`                     | Immutable AI/teacher revisions                          |
| `summary_publications`                             | Published/hidden/pinned student projection              |
| `lecture_material_summary_publications`            | Published material-summary projection                   |

Raw PDF text, raw transcript and audio do not belong in these tables.
Retrieved literature abstracts and article bodies also do not belong in these
tables. Phase 7.2 v6/v2/v4/v3 snapshot/archive functions project at most three
published answers and preserve older RPC versions for expand-first rollout.

## 7. RLS and grants

- Every application table in an exposed schema has RLS enabled.
- Data API access requires both an explicit grant and a matching row policy.
- `TO authenticated` is not authorization by itself.
- UPDATE policies require both `USING` and `WITH CHECK` plus any required SELECT
  policy.
- Public RPCs should remain `SECURITY INVOKER` unless privileged access is
  unavoidable.
- Privileged helpers belong in a non-exposed schema, use a fixed `search_path`,
  verify `auth.uid()` or trusted machine authentication and receive the minimum
  EXECUTE grant.
- Application functions must not retain an implicit `PUBLIC` EXECUTE grant.
- No public application table should be in the Supabase Realtime publication.
- The service role must never reach the browser.

## 8. Index and query rules

Indexes are selected for lecture-scoped and deadline-scoped access. New schema
work must review:

- lecture plus created-at cursor scans;
- lecture plus state/deadline maintenance scans;
- participant ownership and unique response/like constraints;
- presence expiry and shared count-cache refresh;
- AI operation state, lane and deadline cleanup;
- archive-export leases and retry availability.

Every new or changed periodic query requires `EXPLAIN` review and a 20/300-user
load comparison. Avoid an index added only to silence a lint rule without a
documented query.

## 9. Migration and generated types

Current migrations are ordered from the remote baseline through the default-OFF
Phase 7.29C candidate.
The accepted workflow is:

1. create an additive migration with the pinned Supabase CLI;
2. apply all migrations from an empty local database;
3. apply the migration to the previous-Phase fixture;
4. run all pgTAP tests and DB lint;
5. regenerate TypeScript database types;
6. compare generated output in CI;
7. deploy capability with flags OFF;
8. defer destructive contract cleanup until old clients are retired.

Generated database types are a checked-in, deterministic CI contract.
`src/types/database.ts` must be regenerated and drift-checked after a clean
local migration reset during every DB phase.

## 10. Verification entrypoints

```bash
npx supabase db reset --local --no-seed
npx supabase test db --local
npx supabase db lint --local --fail-on error
npm run test:supabase:static
npm run typecheck
```

See `docs/supabase_setup.md`, `docs/SECURITY.md` and the applicable Phase gate
report before changing schema, grants, RLS, Cron or Edge configuration.

## 11. Phase 7.28 additive objects

`display_realtime_sessions` stores only server-side Display binding metadata:
lecture, issuing Admin session/user, first claimed Display auth UID, SHA-256 JTI
hash, random private topic, expiry/revocation and lifecycle timestamps. A
partial unique index permits at most one active binding per lecture. RLS is ON;
`anon` and `authenticated` have no table grant. Private service-role helpers
issue, claim, authorize a topic, terminalize and clean at most 500 old terminal
rows per hourly run. The service-role-only snapshot-fallback verifier joins the
runtime gate, binding, lecture and issuing `admin_sessions` row so Edge never
authorizes a rollback from `revoke_reason` or client state alone.

`ai_master_authorizations` stores one active lecture authorization bound to a
tracked Admin session, actor, exact action array and hard stop.
`ai_master_authorization_events` stores content-free bounded audit metadata.
Child paid starts continue to use `ai_billing_grants` and the existing usage,
operation and concurrency tables. RLS is ON and only explicit service-role
paths can access these new tables/functions.

The two Phase 7.28 migrations are expand-only. A future physical-cleanup
contract must delete dependent audit events, grants and master rows in FK-safe
order; Phase 7.28 performs no destructive schema rollback.

## 12. Phase 7.29 additive Presenter objects

`private.presenter_runtime_gate` is a singleton server kill switch whose
initial value is `false`. It is not exposed to browser roles.

`presenter_connections` stores bounded connection/session metadata: lecture,
issuing tracked Admin session/user, installation, hashed pairing/capability
material, PDF/document/deck digests and counts, ordered Slide ID digest, accepted
sequence/page, expiry/revocation and heartbeat timestamps. It stores no raw
token, recovery code, document bytes, slide text, notes or file path. A partial
unique index permits only one unrevoked connection per lecture.

`presenter_connection_events` stores low-frequency, content-free bounded audit
events tied to the connection. Both public tables have RLS enabled, no browser
policy or grant, service-role-only RPC access and no Realtime publication
membership.

The additive RPC surface issues/inspects/confirms/claims/revokes a binding,
applies an idempotent sequenced page, records bounded heartbeat, reports status,
disconnects, fences legacy Admin page updates and performs bounded cleanup. All
publicly callable Presenter RPCs are `SECURITY INVOKER` with execution revoked
from PUBLIC, `anon` and `authenticated`; fixed-search-path definer triggers are
limited to terminal revocation after lecture close, Admin revoke or PDF-binding
change.

The shared mutation remains `admin_update_pdf_display_v3`. Same-page commits do
not increment live-state versions. The fixed lock order is runtime gate,
tracked Admin session, lecture, live/PDF row, then Presenter row. The migration
is expand-only; rollback disables the runtime gate and leaves the schema in
place until a later FK-ordered contract cleanup.

Phase 7.29C extends `presenter_connections` with the P-256 proof-key identifier
and public SPKI; the non-exportable private key remains in the Windows user
store. The private schema adds:

- `presenter_request_receipts` for atomic proof-key/nonce admission and bounded
  cached positive or negative results;
- `presenter_machine_rate_limits` for proof-key, coarse-network and global
  request buckets;
- `presenter_cleanup_health` for bounded cleanup counts, backlog age and last
  successful execution.

All three private tables have RLS enabled, no `PUBLIC`, `anon` or
`authenticated` access, and only the minimum service-role grants. The raw
manual recovery code, pairing ticket, active capability and private proof key
are never stored; only bounded HMAC/SHA-256 receipts and public-key material
enter the database.

Seven service-role-only, `SECURITY INVOKER` v2 RPCs form the signed machine
surface: `issue_presenter_connection_v2`, `inspect_presenter_connection_v2`,
`claim_presenter_connection_v2`, `apply_presenter_page_v2`,
`heartbeat_presenter_connection_v2`, `disconnect_presenter_connection_v2` and
`cleanup_presenter_security_v2`. Execution remains revoked from `PUBLIC`,
`anon` and `authenticated`. The business RPC wrappers use a three-second
`statement_timeout` (750 ms `lock_timeout` where locking occurs), followed by
the Edge 3.5-second abort, Gateway 4.25-second abort and native five-second
timeout.

## 13. Phase 7.30A-B1 Admin identity objects

The private schema adds seven B1 tables:

- `admin_identity_runtime_gate` for the default-OFF Google issuance switch and
  the historical legacy-login compatibility switch. The E source has no legacy
  issuer/UI; the database switch remains until the dormant operator cutover;
- `admin_environments`, `admin_principals` and
  `admin_environment_memberships` for immutable environment-scoped Google
  identity and owner/instructor membership;
- `admin_invitations` for digest-only, one-time bootstrap/admission material;
- `admin_step_up_nonces` for five-minute, digest-only, Auth-session-bound TOTP
  completion; and
- `admin_audit_events` for bounded append-only identity events.

`public.admin_sessions` remains the existing tracked-session table and gains
authentication method, AAL, principal, membership, environment, Supabase Auth
session, step-up timestamp and nonce provenance. Existing rows are backfilled
as `legacy_pin`/AAL1 with their PIN-version fence intact. New
`google_totp`/AAL2 rows require complete Google provenance and prohibit a PIN
version hash; cross-mode rows fail a database constraint.

All seven private tables have RLS enabled and no browser-role table grants.
The append-only audit table rejects update/delete. Browser roles cannot execute
the service wrappers; Edge uses the minimum service-role RPC surface, while
fixed-search-path definer helpers perform the atomic admission, nonce and
session transitions. The B1 migration is expand-first and does not alter
lecture, PDF, AI, Display or Presenter authorization.

## 14. Phase 7.30B2 Admin AI-unlock database objects

The B2 migration adds nine RLS-enabled private tables:

| Table                                   | Responsibility                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `admin_ai_unlock_runtime_gate`          | Singleton default-OFF AI-unlock and remembered-browser runtime controls                         |
| `admin_ai_policies`                     | Versioned environment/membership action, model, usage, cost, concurrency and validity policy    |
| `admin_ai_unlock_factors`               | Versioned bcrypt cost-12 verifier of a versioned Edge-peppered HMAC; no raw four-digit PIN      |
| `admin_ai_unlock_rate_limits`           | Atomic membership, pepper-hashed coarse-network and environment failure buckets                 |
| `admin_ai_unlock_attempt_receipts`      | Immutable request/input/actor/session/factor-bound positive and negative result replay          |
| `admin_ai_pin_discovery_receipts`       | Five-minute actor/session/factor/version-bound pepper-discovery receipt                         |
| `admin_ai_browser_enrollment_nonces`    | Single-use enrollment intent bound to identity, session, factor, Origin, key fingerprint/expiry |
| `admin_ai_browser_credentials`          | Revocable ES256/P-256 public JWK, RFC 7638 fingerprint and opaque profile credential state      |
| `admin_ai_browser_assertion_challenges` | One-time lecture/scope/session/policy/Origin-bound assertion state                              |

Direct table grants are revoked from `PUBLIC`, `anon`, `authenticated` and
`service_role`; service code uses only the minimum public wrappers. Public
wrappers are `SECURITY INVOKER` and executable only by `service_role`. Required
private `SECURITY DEFINER` helpers use an empty fixed `search_path`, minimum
grants and explicit environment/principal/membership/Admin-session/
`auth.sessions` checks.

`public.admin_sessions` Google/TOTP rows are normalized to the backing
`auth.sessions.created_at + 8 hours` cap with `idle_expires_at = expires_at`.
The backing Auth-session row must exist; touch/new-tab activity cannot extend
the cap. B1's 30-minute idle behavior remains a historical source fact only.

`public.lecture_ai_master_authorizations` gains nullable principal, membership,
issuing-session, unlock method, factor, browser credential, policy and request
provenance. Existing rows remain valid under the expand-first constraint. B2
does not implement lecture ownership or proof-to-master issuance.

Before bcrypt, PIN verification uses nonblocking advisory semaphores capped at
four slots per environment and two per coarse-network bucket. After bcrypt,
canonical row locking atomically updates all applicable rate tiers. Factor
rotation, policy and browser transitions use idempotent authority drains;
cleanup is
bounded, `SKIP LOCKED`, nonblocking by membership and returns `has_more` for
convergence.

Phase 7.30B2.2a adds `verified_totp_factor_set_hash` to Google/TOTP Admin
sessions, an approved hash/version/count plus bounded approval provenance to
`private.admin_principals`, a separate default-OFF operator-adoption gate, and
two more RLS-enabled private tables:

| Table                          | Responsibility                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `admin_control_step_up_nonces` | Digest-only five-minute action/request/session/factor-set/JWT/AMR and canonical-intent challenge state |
| `admin_control_step_up_grants` | Single-use rare PIN/policy authority; exact canonical intent is rederived by the mutation transaction  |

Existing Google sessions are reason-revoked with
`totp_factor_set_migration`; the migration infers neither a session hash nor a
principal approval. Initial `pending_mfa` 0-to-1 setup approves the exact
singleton only inside fresh completion. Existing verified sets require the
Edge-unwired operator-adoption RPC while its own gate is ON and issuance is OFF.
New sessions require approved/live/session equality and completed nonce JWT/AMR
evidence. PIN revoke/reset/profile and factor reconciliation are service-role-
only invoker wrappers. The old PIN-enroll and policy function signatures are
replaced by grant-enforcing facades, while the renamed bodies have no executable
privilege.

Phase 7.30B2.2b adds one RLS-enabled private durable transition table and
binding columns on remembered-browser state:

| Table                           | Responsibility                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `admin_totp_factor_transitions` | One active principal-scoped add/remove authorization, expected post-set and hash-only recovery provenance |

Transition prepare derives verified IDs, target status, count and hash from one
aggregate `auth.mfa_factors` statement snapshot. Authorize consumes one exact
B2.2a grant, caps recovery at the app/Auth session limit and stores no raw
recovery credential. Finalize requires the exact expected live post-set before
advancing the principal approval version and draining old session/AI authority.
Remembered-browser credential/enrollment/assertion rows gain approved factor-set
version, current Auth-session and completion provenance so a new valid AAL2
session may use the same credential without treating enrollment-session identity
as current authority.

Phase 7.30C1 adds four RLS-enabled private tables:

| Table                                | Responsibility                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `admin_lecture_ownerships`           | Optional-row, no-backfill ownership for lectures created by a verified Admin |
| `admin_ai_master_admission_receipts` | Immutable atomic PIN/browser-proof to dormant-master exact replay            |
| `admin_ai_master_reuse_receipts`     | Immutable proof-free same-scope observation; stale retry cannot resurrect    |
| `admin_ai_master_control_receipts`   | Immutable downgrade/revoke request binding and recorded-row convergence      |

The C1 runtime gate is default OFF. Public C1 facades are fixed-search-path
SECURITY DEFINER functions executable only by `service_role`; private tables
and helpers retain no runtime-role grants. Existing lectures and masters are
not adopted. Legacy master/child/direct grant paths are permanently fenced for
an owned lecture, including after master revoke or expiry.

The B2/B2.2a/B2.2b/C1 source/static contracts are implemented, and C2/D have
exact-head runtime evidence. E adds the source and dormant authority described
below; its from-zero migration, pgTAP, two-connection concurrency, populated
C2/D-head upgrades, generated types and DB lint remain exact-head CI
requirements. Hosted/Human activation remains HOLD.

## 15. Phase 7.30C2-D unified authority and Admin ledger

C2 stores one closed Admin operation-policy matrix and immutable intent,
preflight, child, start, claim and dispatch evidence for Google application
sessions. Public operational facades are service-role-only fixed-search-path
definers; browser roles receive no private table access. Status, stop, close,
revoke and other explicitly classified safe controls remain available when an
admission gate is OFF.

D adds private invitation-redemption evidence, owner-ledger operation receipts
and bounded ledger policy/audit state. Owner-only mutations serialize by
environment and request, consume a five-minute operation/digest-bound TOTP
control grant and preserve the last active owner. Disabling AI drains persistent
AI authority without ending the Admin session; suspension/revocation drains the
target membership's sessions and descendants. All private evidence tables use
RLS without browser policies and retain append-only or transition-constrained
history.

## 16. Phase 7.30E Google-only cutover objects

The first E migration adds the service-only
`verify_google_display_terminal_session_v1` facade. It locks durable Google
Display issuance by JTI hash and rechecks lecture, issued/expires timestamps and
Display Auth UID before terminal downgrade or archive access. Unknown legacy
descendants and cross-UID claims are invalid.

The dormant authority migration adds three RLS-enabled, policy-free private
tables:

| Table                                     | Responsibility                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `admin_lecture_ownership_claim_approvals` | Immutable postgres-operator mapping and lecture status/lifecycle snapshot          |
| `admin_lecture_ownership_claim_receipts`  | Exact-replay application of one approved `operator_claim` ownership                |
| `admin_identity_cutover_receipts`         | Immutable Google-only tombstone, deployment-evidence digest and final guard counts |

Approval and cutover functions are postgres-owner-only; `service_role`, browser
roles and `PUBLIC` have no execute privilege. Claims derive every target from
the immutable approval and never infer ownership from request input. The
cutover function requires SERIALIZABLE isolation, environment/request mutexes
and `ACCESS EXCLUSIVE NOWAIT` locks before its same-transaction guards and
legacy-session revocation. Post-tombstone triggers prevent re-enabling legacy
admission, creating/extending/resurrecting a legacy session or committing an
active lecture without ownership. Applying the migration creates no approval,
claim or tombstone and changes no active gate or session. Historical billing
compatibility authority is a separate retirement boundary.

## 17. Phase 7.30F read-only evidence projection

Phase F adds one observational migration,
`20260812142023_phase7_30f_source_readiness_preflight.sql`, and one stable
`SECURITY DEFINER` function,
`private.get_phase7_30f_source_readiness_preflight_v1(uuid)`. EXECUTE is
revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, leaving it
postgres-owner-only. It adds no table, trigger, runtime gate, receipt,
application-role grant or policy and changes no active state. Its companion
`scripts/phase7-30f-hosted-readonly-preflight.sql` is an operator-reviewed,
read-only staging evidence projection and is never invoked against Hosted by
repository CI. The projection preserves the exact 16-key advisory output of
`private.get_google_only_admin_cutover_preflight_v1(uuid)` and supplements it
with bounded direct observations for the legacy-login gate, invalid active
ownership, immutable cutover receipt/digest agreement, legacy-verifier ACL,
post-cutover fence triggers and historical billing ACLs.

`preCutover` and `postCutover` are separate manifest objects. The former stays
`authoritative = false` and cannot authorize the E operator transaction. The
latter can be recorded only after a separately approved transaction and must
agree with the immutable receipt. Neither object contains an environment UUID,
principal/user ID, project ref, host, email, token, PIN or secret value.

The current historical billing admission inventory has six functions:

| Function | Phase F treatment |
| -------- | ----------------- |
| `private.issue_ai_billing_grant(uuid,text[],text,boolean,text)` | existence, owner, language, security and effective EXECUTE metadata only |
| `public.admin_issue_ai_billing_grant(uuid,text[],text,boolean,text)` | same; current compatibility wrapper is not invoked |
| `private.consume_ai_billing_grant_and_start_operations(uuid,text,uuid,jsonb,text)` | same; current direct consumer is not invoked |
| `public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)` | same; current direct consumer wrapper is not invoked |
| `public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)` | same; current service wrapper is not invoked |
| `public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)` | same; current service wrapper is not invoked |

The C1 migration already revoked `service_role` EXECUTE from the retained
private master implementations, so they are outside this exact effective-six
inventory. Each listed function is reported under the matching
`legacyBillingAcl` key with `publicExecute`, `anonExecute`,
`authenticatedExecute` and `serviceRoleExecute` booleans.

Any runtime-reachable historical admission remains a Production `HOLD`.
Revoking or dropping these paths belongs to a later separately reviewed
default-OFF retirement migration after personal-AI-PIN Hosted/Human evidence;
it is not a Phase F source/local schema change.
