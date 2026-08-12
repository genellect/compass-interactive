# Phase 7.30F Hosted/Human identity readiness

Status: Implemented, verification pending
Scope: source/local evidence contract and separately approved staging Hosted/Human execution gate for the Google-only Admin identity migration
Gate state: source/local readiness candidate; Phase 7.30E exact-head CI and merge were still pending when this document branch was cut; every Hosted value, mutation, Human run, cutover, secret deletion, billing retirement, canary and activation remains HOLD
Approval: source/local implementation only; no Hosted, OAuth, Human, cutover, deletion, billing, paid-provider or activation authority
Last verified: 2026-08-12

## 1. Purpose and non-goals

Phase 7.30F turns the approved Hosted/Human requirements into a strict,
machine-readable evidence and approval contract. It prepares a reviewer to
answer whether one exact source revision is safe to take to a **separate
staging execution request**. It does not connect to Supabase, Google,
Cloudflare, OpenAI or Production, and it does not itself execute the Phase
7.30E cutover.

This tranche deliberately performs no Hosted mutation. In particular, it does
not:

- create or edit a Google OAuth client, consent screen, callback or Origin;
- link to, migrate, deploy to or configure a Hosted Supabase project;
- invite a real account, enroll TOTP, rotate a token or run a Human test;
- invoke the Phase 7.30E identity cutover or delete `ADMIN_PIN`;
- revoke historical billing authority or delete `BILLING_PIN`;
- enable a frontend, Edge or database admission flag;
- call a paid provider, publish the repository, invite a contest reviewer, or
  declare a Production release.

Phase 7.30F remains a bounded identity-migration gate. Phase 7.31 publication,
Phase 7.32 commercial/legal readiness and the integrated Phase 7.33
Production Gate remain independent and HOLD.

## 2. Decision vocabulary

The readiness tooling has only the following decision words:

| Field / value                              | Meaning |
| ------------------------------------------ | ------- |
| `sourceReadiness = SOURCE_READY`           | The exact source revision, schema/example, static checks, local safety contract and default-OFF topology are internally consistent. This says nothing about a Hosted deployment. |
| `sourceReadiness = HOLD`                   | Source evidence is absent, incomplete, stale, unsafe or contradictory. |
| `decision = HOLD`                          | The default. No external action is authorized. Missing evidence, approval or reviewer separation always resolves here. |
| `decision = READY_FOR_SEPARATE_HOSTED_EXECUTION` | The redacted prerequisite dossier is structurally complete enough to request a new, separately authorized staging execution. It is not permission to perform that execution and is not evidence that it ran. |

`Production PASS` is prohibited as a Phase 7.30F validator output. No local,
CI, schema, example manifest, read-only query or repository review can emit or
imply it. A valid source-only example is expected to report
`sourceReadiness = SOURCE_READY` while its decision remains `HOLD`.

The command with no evidence argument returns a deterministic redacted `HOLD`
and exits successfully. Malformed, unknown-field, secret-shaped,
Production-targeted or contradictory input is a validation error and exits
nonzero. `--json` output contains only the validated decision, safe reason
codes and non-sensitive counts/digests.

## 3. Source artifacts and trust boundary

| Artifact | Responsibility |
| -------- | -------------- |
| `docs/evidence/phase7-30f-readiness.schema.json` | Closed JSON Schema for a redacted evidence manifest; unknown fields and missing required fields fail. |
| `scripts/fixtures/phase7-30f-evidence.example.json` | Synthetic staging-shaped example. It contains no project ref, host, person, credential or real deployment value and remains `HOLD`. |
| `scripts/phase7-30f-readiness.mjs` | Pure local validator. It reads only the supplied file, performs no network, child process, database or filesystem write, and never changes a gate. |
| `scripts/phase7-30f-hosted-readonly-preflight.sql` | Operator-reviewed, read-only SQL that returns bounded counts, booleans, names and digests. Repository CI never runs it against Hosted. |
| `scripts/test-phase7-30f-static.mjs` | Positive, negative, redaction, default-HOLD and source-contract tests included in the 75-group non-live suite. |

Actual evidence files are operator-controlled and ignored by Git. They must
not be attached to an issue, PR or CI artifact. The schema and example are
public-boundary-safe templates only.

The validator accepts metadata, not proof material. It rejects secret-shaped
keys or values, including JWTs, bearer strings, PEM blocks, service-role keys,
OAuth tokens/client secrets, raw PINs, TOTP seeds/codes, recovery codes,
database dumps, project refs, real domains, email addresses and Auth or
application user IDs. Function evidence contains only function name, reviewed
revision/digest and JWT-verification metadata. Secret evidence contains only
the secret **name**, presence/absence, rotation-state metadata and a bounded
timestamp; never a value or value digest.

Every manifest is staging-only, names the exact 40-hex source commit, uses
64-hex SHA-256 evidence digests and RFC 3339 UTC timestamps, and records the
collector/reviewer as non-personal role aliases. `production` and `contest`
targets are rejected. An evidence digest proves only the referenced redacted
artifact; it does not prove the external state without the independent Human
review recorded below.

## 4. Source/local checklist

Before `SOURCE_READY` may be reported, all of the following must be true for
one exact candidate SHA:

- [ ] Phase 7.30E is merged and its exact merge SHA has green post-merge CI.
- [ ] The Phase F branch is based on that merged revision; no E candidate
      history is accidentally replayed in the F PR.
- [ ] `security:secrets`, type checks, lint, build, all 75 non-live groups,
      Demo Chromium/WebKit and the full local Supabase gate are green for the
      exact Phase F head.
- [ ] Fresh and populated migrations, generated types, all pgTAP, DB lint,
      concurrency, upgrade, Local Edge and browser evidence cover Phase
      0-7.30 without invoking the dormant E cutover.
- [ ] `test:phase7-30f-static` proves default `HOLD`, strict schema handling,
      unknown/missing-field rejection, contradiction rejection, secret/PII
      rejection, staging-only targeting and redacted output.
- [ ] Frontend, Edge and database identity/AI/ledger/master activation topology
      is internally consistent and all activation values remain false or
      omitted in source readiness.
- [ ] `PHASE730_C1_GOOGLE_AI_MASTER_ENABLED` is included in the server Boolean
      inventory and cannot be treated as an unvalidated free-form value.
- [ ] The 19 Google-only operational Edge entries remain present and
      `verify-admin-pin` plus `authorize-ai-start` remain absent from current
      source/config.
- [ ] The independent final reviewer sees only the exact diff, threat model,
      tests and redacted evidence and records zero unresolved Critical/High
      finding.
- [ ] Repository and CI logs contain no Hosted identifier, secret, real
      account data or evidence file.

A checked source/local list is not Hosted evidence. It can establish
`SOURCE_READY`; without a separately approved external run the overall
decision remains `HOLD`.

## 5. Exact Hosted evidence envelope

After separate approval, an operator may fill a private manifest from
read-only staging observations. Collection and review must preserve these
separate sections:

1. `source`: exact commit, repository-CI run digests and independent-review
   disposition;
2. `environment`: staging classification, opaque environment digest and
   environment separation result, never a project ref or URL;
3. `deployment`: immutable frontend and Edge revision digests plus the exact
   19-function inventory;
4. `oauth`: callback/Origin/consent **result metadata** and review timestamp,
   never a client ID, client secret, domain or redirect value;
5. `secretInventory`: required/forbidden names with presence and rotation
   metadata only;
6. `preCutover` and `postCutover`: two distinct read-only database snapshots;
7. `humanMatrix`: bounded scenario IDs and outcomes with no email, user ID,
   factor secret or screenshot containing identity data;
8. `advisors`: Supabase Security/Performance Advisor Critical/High counts and
   redacted report digests;
9. `rollback`: immutable Google-only revision, operator recovery rehearsal and
   stop-condition evidence digests; and
10. `approvals`: separately scoped decisions described in section 9.

The exact operational Edge inventory is:

1. `analyze-lecture-material`
2. `generate-academic-answer`
3. `generate-lecture-summary`
4. `issue-display-session`
5. `issue-pdf-access-token`
6. `issue-realtime-client-secret`
7. `manage-admin-sessions`
8. `manage-ai-control`
9. `manage-comments`
10. `manage-lectures`
11. `manage-lecture-summaries`
12. `manage-material-analysis`
13. `manage-pdf-documents`
14. `manage-pdf-publications`
15. `manage-polls`
16. `manage-presenter-connection`
17. `operator-live-snapshot`
18. `publish-caption-window`
19. `update-display-state`

Each inventory row records only the name, immutable deployed revision digest,
JWT-verification posture and review timestamp. Exact set equality is required;
duplicates, unknown entries, missing entries, or either retired endpoint cause
`HOLD`.

The Hosted function inventory must independently confirm that
`verify-admin-pin` and `authorize-ai-start` are not deployed. The Hosted secret
inventory must confirm that `ADMIN_PIN` and `BILLING_PIN` are absent before any
Production-bound decision. Source deletion, an absent config stanza or an
empty local environment variable is not a substitute for those Hosted
observations. The Phase E cutover and the two secret deletions remain three
separate approvals; the validator must not infer one from another.

## 6. Pre-cutover and post-cutover database evidence

`preCutover` is advisory and cannot authorize the E transaction. It preserves
the exact 16-key result from
`private.get_google_only_admin_cutover_preflight_v1(uuid)`:

- `activeLegacyMasterCount`
- `activeLegacySessionCount`
- `activeOwnerCount`
- `authoritative`
- `cutoverCommitted`
- `environmentReady`
- `externalTransportAttestationRequired`
- `googleAdminLedgerEnabled`
- `googleOperationalAuthorizationEnabled`
- `googleSessionIssueEnabled`
- `issuedLegacyGrantCount`
- `pendingLegacyAcademicCount`
- `runningLegacySummaryCount`
- `runningLegacyUsageCount`
- `unboundPdfPublicationCount`
- `unownedActiveLectureCount`

The read-only SQL additionally records bounded direct observations that the E
advisory function does not include: `legacy_pin_login_enabled`, invalid active
ownership count, cutover-receipt state and digest agreement, legacy-verifier
`service_role` EXECUTE state, the six historical billing admission functions'
ACL/security state, and required post-cutover trigger enablement. The advisory
result must retain `authoritative = false` and
`externalTransportAttestationRequired = true`; neither field may be rewritten
by the collector.

`postCutover` is a separate observation after an independently approved E
operator transaction. It must prove the immutable receipt and supplied
deployment-evidence digest agree, legacy login is disabled, no active legacy
session or unresolved descendant authority remains, legacy verifier
`service_role` EXECUTE is revoked, all tombstone/session/lecture fence triggers
are enabled, and the two-owner/ownership invariants still hold. Copying the
pre-cutover object into `postCutover`, marking a not-executed step as complete,
or presenting an advisory result as authoritative is a contradiction and
causes `HOLD` or validation failure.

Repository CI never invokes the cutover, and the presence of a post-cutover
schema field is not evidence that the cutover ran.

## 7. Historical billing compatibility: six read-only evidence paths

Phase F inventories the current six-function legacy admission chain exactly:

1. `private.issue_ai_billing_grant(uuid,text[],text,boolean,text)`
2. `public.admin_issue_ai_billing_grant(uuid,text[],text,boolean,text)`
3. `private.consume_ai_billing_grant_and_start_operations(uuid,text,uuid,jsonb,text)`
4. `public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)`
5. `public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)`
6. `public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)`

The C1 migration already revoked `service_role` EXECUTE from the private
`authorize_ai_master` and `issue_ai_billing_grant_from_master` functions, so
those private implementations are not counted as current effective admission
paths. This inventory follows effective `service_role` reachability rather
than counting every retained implementation function.

The evidence records existence, owner, language, security mode and effective
EXECUTE roles for all six. Presence of any still-runtime-reachable historical
admission path remains an explicit `HOLD` for Production. This source/local
readiness tranche does **not** revoke, rename, drop or execute any of them.

Billing retirement is a later, separately reviewed default-OFF migration only
after personal-AI-PIN local and Hosted/Human evidence. Its application and the
subsequent `BILLING_PIN` secret deletion require distinct approvals. Safe
status, stop, revoke, accounting and historical FK/audit integrity must remain
available; rollback never restores shared billing admission.

## 8. Staging Hosted/Human checklist

The following checklist may be executed only after its own approval. No paid
provider call is implied; paid traffic remains separately authorized.

### Environment and identity

- [ ] The target is a separate staging Supabase project and separate OAuth
      client/callback/Origin set; it shares no Production identity, data or
      secret.
- [ ] Callback allowlists, exact Origins and OAuth consent behavior pass both
      allowed and denied cases without open redirects.
- [ ] Two distinct owner accounts, one AI-enabled instructor, one standard
      instructor and one suspended instructor are provisioned without writing
      their emails or IDs into evidence.
- [ ] Google AAL1 yields no privileged data; Supabase Authenticator App TOTP
      establishes AAL2 and one tracked Google application session.
- [ ] AAL2 session continuity has no 30-minute idle or periodic TOTP prompt and
      respects the backing Auth-session eight-hour cap.

### Authorization and recovery

- [ ] Own-lecture success and cross-user, cross-lecture and
      cross-environment denial pass for owner and instructor roles.
- [ ] Individual self/owner revoke, global revoke, suspension races,
      `can_use_ai=false`, role change and last-owner protection converge
      transactionally.
- [ ] Token refresh/rotation, stale JWT, stale app session, backing
      `auth.sessions` deletion and Google/Supabase account disable fail closed.
- [ ] TOTP factor-set change drains the old app session and derived authority;
      owner recovery is rehearsed from a separate trusted owner path.
- [ ] If both owners are unavailable, the documented time-bounded Supabase
      operator recovery path is rehearsed and audited without a shared PIN.

### Personal AI intent and lecture continuity

- [ ] Initial AI PIN enrollment reuses the fresh login TOTP; normal PIN verify,
      remembered-browser proof, lecture master and child controls do not add a
      TOTP prompt.
- [ ] A valid personal AI PIN or remembered-browser proof creates authority
      only for an owned open lecture and allowed scope; raw PIN and private key
      are absent from persistence, URL, log, audit and traces.
- [ ] Same-scope retry is idempotent, scope escalation requires a new AI proof
      but no fresh TOTP, downgrade/stop are proof-free, and no master action
      starts a provider or Realtime automatically.
- [ ] PIN/factor/browser/session/membership/policy/lecture revoke and expiry
      follow the approved drain matrix while preserving safe status and stop.

### Regression and review

- [ ] Phase 0-7.30 DB, Edge, browser, load, security, accessibility and rollback
      regressions pass for the exact staged revision.
- [ ] Desktop and Mobile Chromium/WebKit cover Admin and student success,
      denial, reload/recovery, console/page errors and horizontal overflow.
- [ ] Student Auth, five-second snapshot, PDF, Display, Poll, Archive and
      Presenter-OFF behavior remain unchanged.
- [ ] Hosted Security and Performance Advisors contain zero unresolved
      Critical/High finding, and the independent reviewer records zero
      unresolved Critical/High finding.

## 9. Approval separation

An approval is valid only for the exact source SHA, staging environment digest,
requested action digest, expiry and rollback revision it names. It is never
inferred from a green test, earlier plan approval or another action's approval.
The following are separate stop points:

| Approval | Effect if granted | Does not authorize |
| -------- | ----------------- | ------------------ |
| `staging_hosted_mutation` | Apply the reviewed default-OFF revision/configuration to the named staging environment. | OAuth/provider changes, Human enrollment, cutover, deletion or activation. |
| `oauth_provider_configuration` | Configure the exact staging Google/Supabase callback, Origin and consent contract. | Invitations, cutover, secret deletion or Production use. |
| `staging_human_identity_run` | Use the named role slots for the bounded Human matrix. | Paid calls, E cutover or secret deletion. |
| `phase7_30e_identity_cutover` | Invoke the reviewed E operator transaction using the independently verified deployment digest. | Deleting `ADMIN_PIN`, billing retirement or enabling a canary. |
| `admin_pin_secret_deletion` | Delete only the obsolete Hosted `ADMIN_PIN` secret after post-cutover proof. | Billing changes or activation. |
| `billing_compatibility_retirement` | Apply the separately reviewed default-OFF retirement migration. | Deleting `BILLING_PIN` or enabling paid AI. |
| `billing_pin_secret_deletion` | Delete only `BILLING_PIN` after retirement and rollback evidence. | Paid traffic or Production activation. |
| `limited_identity_canary` | Enable only the approved bounded staging/identity cohort with named stop conditions. | Repository publication, contest access, commercial release or Phase 7.33 PASS. |

Production activation, external publication, contest invitations, paid-provider
traffic and legal/commercial acceptance remain outside this table and require
their own later approvals. An expired, missing, reused or scope-mismatched
approval causes `HOLD`.

## 10. Rollback and stop conditions

Before E cutover, rollback disables admission flags, restores the reviewed
immutable Google-only application revision, revokes staged sessions and stops
new invitations. It does not call the cutover or delete a secret.

After E cutover, rollback never restores `ADMIN_PIN`, a legacy session issuer
or a dual-login application. It keeps the immutable receipt and audit evidence,
uses the reviewed Google-only revision, disables new admission, preserves safe
status/close/stop/revoke/downgrade and uses operator owner recovery if needed.

After billing retirement, rollback never restores `BILLING_PIN` admission. New
paid starts stay disabled until personal AI identity, policy and intent are
re-proven; historical accounting rows remain only for integrity. No emergency
down migration or destructive evidence deletion is a recovery technique.

Stop immediately and retain redacted evidence if any of the following occurs:

- owner, principal, environment, lecture or session boundary leakage;
- AAL1 privileged data, old-session resurrection or last-owner bypass;
- a secret, identity value, PIN, token, recovery material or private key enters
  evidence, logs, browser persistence, Git or CI artifacts;
- callback/origin widening, unexpected function/secret inventory, disabled
  fence trigger or deployment-digest mismatch;
- an unresolved Critical/High Advisor or independent-review finding;
- loss of safe stop/revoke, student/PDF/Display behavior or immutable rollback;
  or
- any external action outside the exact approval scope.

The containment order is: stop new admission, revoke the affected individual
or cohort, disable paid starts, return to the immutable Google-only revision,
use operator owner recovery if required, preserve content-free audit evidence,
and obtain a new approval before resuming.

## 11. Gate conclusion

Merging this source/local tranche may establish `SOURCE_READY` for an exact
green Phase F head. Until a separately approved staging run supplies and
independently reviews the Hosted/Human evidence above, the decision remains
`HOLD`.

Even `READY_FOR_SEPARATE_HOSTED_EXECUTION` only means that a new execution
request may be presented. It does not execute or pass Phase 7.30F, does not
authorize Production, and does not reduce the Phase 7.33 integrated Gate.
