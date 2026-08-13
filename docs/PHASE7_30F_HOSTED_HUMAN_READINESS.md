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

| Field / value                                    | Meaning                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceReadiness = SOURCE_READY`                 | The exact source revision, schema/example, static checks, local safety contract and default-OFF topology are internally consistent. This says nothing about a Hosted deployment.                                                                                             |
| `sourceReadiness = HOLD`                         | Source evidence is absent, incomplete, stale, unsafe or contradictory.                                                                                                                                                                                                       |
| `decision = HOLD`                                | The default. No external action is authorized. Missing evidence, approval or reviewer separation always resolves here.                                                                                                                                                       |
| `decision = READY_FOR_SEPARATE_HOSTED_EXECUTION` | A complete staging dossier, including separately approved Hosted/Human observations, is internally consistent enough to request the **next** separately approved external step. It neither authorizes that step nor independently proves the supplied external observations. |

`Production PASS` is prohibited as a Phase 7.30F validator output. No local,
CI, schema, example manifest, read-only query or repository review can emit or
imply it. Schema validity alone never emits `SOURCE_READY`: the tracked
source-only example intentionally reports both `sourceReadiness = HOLD` and
`decision = HOLD`. `SOURCE_READY` additionally requires the declared E merge
SHA, green E post-merge CI, verified candidate ancestry from that exact E
merge, every named source check at the candidate SHA and a later independent
source review with zero Critical/High findings.
Manifest-local states such as `APPROVED`, `REJECTED`, `PASS`, `FAIL` and
`NOT_RUN` describe individual approval or evidence records; they are not
validator decision words and cannot be promoted into `decision` or
`sourceReadiness`.

The command with no evidence argument returns a deterministic redacted `HOLD`
and exits successfully. Malformed, unknown-field, secret-shaped,
Production-targeted or contradictory input is a validation error and exits
nonzero. `--json` output contains only the validated decision, safe reason
codes and non-sensitive counts/digests.

## 3. Source artifacts and trust boundary

| Artifact                                                                       | Responsibility                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/evidence/phase7-30f-readiness.schema.json`                               | Closed JSON Schema for a redacted evidence manifest; unknown fields and missing required fields fail.                                                                                                 |
| `scripts/fixtures/phase7-30f-evidence.example.json`                            | Synthetic staging-shaped example. It contains no project ref, host, person, credential or real deployment value and remains `HOLD`.                                                                   |
| `scripts/phase7-30f-readiness.mjs`                                             | Pure local validator. It reads only the supplied file, performs no network, child process, database or filesystem write, and never changes a gate.                                                    |
| `supabase/migrations/20260812142023_phase7_30f_source_readiness_preflight.sql` | Adds only the postgres-owner read-only projection `private.get_phase7_30f_source_readiness_preflight_v1(uuid)`. It creates no runtime gate, receipt, grant to an application role or external action. |
| `supabase/tests/phase7_30f_source_readiness_preflight_test.sql`                | pgTAP contract for the projection shape, exact ACL inventory and owner-only EXECUTE boundary.                                                                                                         |
| `scripts/phase7-30f-hosted-readonly-preflight.sql`                             | Operator-reviewed, read-only SQL that returns bounded counts, booleans, names and digests. Repository CI never runs it against Hosted.                                                                |
| `scripts/test-phase7-30f-static.mjs`                                           | Positive, negative, redaction, default-HOLD and source-contract tests included in the 75-group non-live suite.                                                                                        |

Actual evidence files are operator-controlled and must use the repository-root
name `.phase7-30f-evidence*.json`; the exact anchored ignore contract is
`/.phase7-30f-evidence*.json`. They must not be placed under another directory,
force-added, attached to an issue or PR, or uploaded as a CI artifact. The
CLI rejects any path whose canonical parent is not the repository root or
whose basename does not match that private naming contract. CI separately
enumerates the Git index with `git ls-files --cached` and fails on a tracked
root or nested `.phase7-30f-evidence*.json`, including a force-added ignored
file, independently of secret-content scanning. The schema and example are
public-boundary-safe templates only.

The database projection's raw operator result may contain an environment UUID,
receipt timestamp and deployment-evidence digest needed for exact comparison.
That raw result is not a validator manifest and must never enter Git, a PR or a
CI artifact. The operator SQL maps it to the closed, redacted manifest fields;
only counts, booleans and approved opaque digests cross that boundary.

The validator accepts metadata, not proof material. It rejects secret-shaped
keys or values, including JWTs, bearer strings, PEM blocks, service-role keys,
OAuth tokens/client secrets, raw PINs, TOTP seeds/codes, recovery codes,
database dumps, project refs, real domains, email addresses and Auth or
application user IDs. Each function-inventory entry contains exactly `name`,
positive integer `version` and Boolean `verifyJwt`; the deployment and
immutable-revision digests are recorded once at the enclosing Hosted evidence
level. Secret evidence contains only the secret **name**, presence/absence,
rotation-state metadata and a bounded timestamp; never a value or value
digest. Every `rotatedAt` or `removedAt` must be no later than the enclosing
inventory `capturedAt`.

Every manifest is staging-only, uses the closed non-personal alias vocabulary
`staging-identity-slot-[a-z]`, names the exact 40-hex source commit, uses
64-hex SHA-256 evidence digests and RFC 3339 UTC timestamps. `production` and
`contest` targets are rejected. The closed manifest accepts no collector or
reviewer identity; operator-controlled source artifacts use non-personal role
aliases, and `independentReview.separateFromExecutor` records executor
separation while `independentReview` also records bounded Critical/High
finding counts; readiness requires both counts to be zero. An
evidence digest proves only the referenced redacted
artifact; it does not prove the external state without the independent Human
review recorded below.

## 4. Source/local checklist

Before `SOURCE_READY` may be reported, all of the following must be true for
one exact candidate SHA:

- [ ] Phase 7.30E is merged and its exact merge SHA has green post-merge CI.
- [ ] The Phase F branch is based on that merged revision; no E candidate
      history is accidentally replayed in the F PR.
- [ ] `sourceEvidence.phase730fBaseOnMergedE` observes the exact candidate SHA
      while `phase730fBaseCommitSha` equals the independently verified E merge
      SHA; together they prove ancestry rather than merely repeating a base
      SHA.
- [ ] `security:secrets`, type checks, lint, build, all 75 non-live groups,
      Demo Chromium/WebKit and the full local Supabase gate are green for the
      exact Phase F head.
- [ ] Fresh and populated migrations, generated types, all pgTAP, DB lint,
      concurrency, upgrade, Local Edge and browser evidence cover Phase
      0-7.30 without invoking the dormant E cutover.
- [ ] `test:phase7-30f-static` proves default `HOLD`, strict schema handling,
      unknown/missing-field rejection, contradiction rejection, secret/PII
      rejection, staging-only targeting and redacted output.
- [ ] In `SOURCE_READINESS_EXAMPLE`, every frontend/server activation flag is
      false, `legacyPinLoginEnabled` alone remains true and every new database
      identity/AI/ledger/master gate remains false.
- [ ] `PHASE730_C1_GOOGLE_AI_MASTER_ENABLED` is included in the server Boolean
      inventory and cannot be treated as an unvalidated free-form value.
- [ ] The 19 Google-only operational Edge entries remain present and
      `verify-admin-pin` plus `authorize-ai-start` remain absent from current
      source/config.
- [ ] The separate three-entry identity/control inventory contains exactly
      `admin-identity-session`, `admin-ai-unlock` and `manage-admin-ledger`;
      both inventories have `verifyJwt = true` for every row.
- [ ] The independent final reviewer sees only the exact diff, threat model,
      tests and redacted evidence and records zero unresolved Critical/High
      finding.
- [ ] Repository and CI logs contain no Hosted identifier, secret, real
      account data or evidence file.

A checked source/local list is not Hosted evidence. It can establish
`SOURCE_READY`; without a separately approved external run the overall
decision remains `HOLD`.

The two evidence modes intentionally describe different states. A complete
`HOSTED_HUMAN_STAGING` dossier records the outcome of separately approved work:
all corresponding frontend and server flags are true, `legacyPinLoginEnabled`
is false, and the remaining post-cutover database gates are true. Frontend,
server and latest database-snapshot values must agree; a mismatch is rejected.
These ON values are observations supplied to the validator after approval, not
changes made or independently discovered by it. `limitedIdentityCanary` and
`productionActivation` still remain `HOLD` even in a complete dossier.

## 5. Exact Hosted evidence envelope

After separate approval, an operator may fill a private manifest from
read-only staging observations. Collection and review must preserve these
exact schema sections:

1. `configuration.environment`: staging-only alias, exact source commit,
   capture state and environment-ID-configured Boolean, never the ID, project
   ref, URL or domain;
2. `configuration.frontendFlags`, `configuration.serverFlags` and
   `configuration.databaseGates`: exact corresponding topology values;
3. `configuration.secretInventory`: required/forbidden names with presence and
   rotation metadata only;
4. `sourceEvidence`: the strict schema, rejection, offline/default-HOLD,
   pre/post separation and Production-PASS prohibition contract;
5. `hostedEvidence`: execution time, deployment/immutable-revision digests,
   source/retired-wire/OAuth result Booleans, the exact 19 operational
   functions and the separate exact three identity/control functions;
6. `preCutover` and `postCutover`: two distinct read-only database snapshots;
7. `billingRetirement`: a third, later read-only ACL/integrity observation,
   never folded into the identity cutover snapshot;
8. `humanEvidence`: the exact bounded scenario results, with no email, user
   ID, factor secret or screenshot containing identity data;
9. `regressionEvidence`: DB/Edge/browser/CI/load/security/accessibility/
   rollback outcomes plus bounded Advisor Critical/High counts;
10. `rollbackEvidence`: immutable Google-only revision, operator recovery and
    safe stop/recovery results;
11. `approvals`: the exact separately scoped decisions in section 9; and
12. `independentReview`: status, timestamp, redacted evidence digest,
    executor-separation result and bounded Critical/High counts.

OAuth has no free-form object: `hostedEvidence.callbackOriginAllowlistPass`
and `hostedEvidence.oauthConsentPass` hold the Hosted result, while
`humanEvidence.googleCallbackOriginAllowlist` and `humanEvidence.oauthConsent`
hold the bounded Human scenarios. No client ID, secret, domain, callback value
or redirect value is accepted.

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

The exact identity/control inventory is separate so the established
19-operation term remains unambiguous:

1. `admin-identity-session`
2. `admin-ai-unlock`
3. `manage-admin-ledger`

Each inventory row records exactly `name`, positive integer `version` and
Boolean `verifyJwt`. The immutable deployed revision and deployment-evidence
digests belong to the enclosing Hosted evidence object, not an individual
function row. Exact set equality is required; duplicates, unknown entries,
missing entries, a false `verifyJwt`, or either retired endpoint cause `HOLD`.

The two Hosted function inventories must independently confirm that
`verify-admin-pin` and `authorize-ai-start` are not deployed. The Hosted secret
inventory records a `removedAt` time for each absent secret. Source deletion,
an absent config stanza or an empty local environment variable is not a
substitute for those Hosted observations. `ADMIN_PIN` is removed only after
post-cutover proof; `BILLING_PIN` is removed only after the distinct billing
retirement and rollback proof. The validator must not infer any approval from
another operation.

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

The read-only SQL maps these 16 keys plus 28 bounded direct observations to an
exact 44-key flat snapshot. The additional fields are six identity/AI gate
Booleans (`legacyPinLoginEnabled`, operator TOTP adoption/mutation, AI unlock,
Google AI-master admission and remembered-browser state), invalid active
ownership count, three cutover-receipt checks, legacy-verifier
`service_role` EXECUTE state, `legacyBillingAcl` and the grouped `triggers`
object. They also include exact membership/personal-factor counts (total and
role-correlated owner, AI-enabled instructor, standard instructor and
suspended-instructor evidence) and exact active Google-session counts for
backing `auth.sessions`, the eight-hour cap and idle-cap equality. This
includes `cutoverReceiptDeploymentEvidenceDigestMatches` and the
exact trigger keys `legacyGateTombstoneEnabled`,
`legacySessionFenceEnabled`, `activeLectureOwnershipFenceEnabled` and
`googleSessionAbsoluteIdleTriggerEnabled`. The last key proves the durable
`admin_sessions_google_absolute_idle` enforcement trigger is enabled; clean
session counts alone are insufficient. Each of the four trigger Booleans
requires the exact table/name, expected trigger-function OID, row-level
timing/event bitmask, normal enabled state `O` and normal-versus-constraint
deferrable/initially-deferred shape. A same-name no-op or differently timed
trigger is false evidence. The absolute/idle trigger additionally binds the
exact update-column set `authentication_method`, `auth_user_id`,
`supabase_auth_session_id`, `issued_at`, `expires_at` and `idle_expires_at`.
The
advisory result must retain `authoritative = false` and
`externalTransportAttestationRequired = true`; neither field may be rewritten
by the collector. Readiness requires two active owners, at least one
AI-enabled instructor, standard instructor, suspended instructor and eligible
personal-AI-PIN factor; approved-TOTP coverage must be role-correlated (two
owners plus one of each active instructor role). At least one Google app
session must be active, with zero unbacked, over-eight-hour, idle-cap mismatch
or invalid current principal/membership/factor-set authority session.
Approved-TOTP counts are not cached-flag counts: every included principal's
approved factor-set hash must equal the current verified `auth.mfa_factors`
set, so removing or changing a factor immediately removes that principal from
the readiness projection.

`postCutover` is a separate observation after an independently approved E
operator transaction. It must prove the immutable receipt and supplied
deployment-evidence digest agree, legacy login is disabled, no active legacy
session or unresolved descendant authority remains, legacy verifier
`service_role` EXECUTE is revoked, all tombstone/session/lecture fence triggers
are enabled, and the two-owner/ownership invariants still hold. Copying the
pre-cutover object into `postCutover`, marking a not-executed step as complete,
or presenting an advisory result as authoritative is a contradiction and
causes `HOLD` or validation failure.

The post-cutover identity snapshot must still show the six legacy billing
paths as `service_role`-only. Marking them retired in `postCutover` conflates
two separately approved operations and is rejected. Their all-revoked state
belongs only in the later `billingRetirement` snapshot.

Repository CI never invokes the cutover, and the presence of a post-cutover
schema field is not evidence that the cutover ran.

## 7. Historical billing compatibility: six read-only evidence paths

Phase F inventories the current six-function legacy admission chain exactly:

| `legacyBillingAcl` key                           | Exact function signature                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `publicAdminIssueAiBillingGrant`                 | `public.admin_issue_ai_billing_grant(uuid,text[],text,boolean,text)`               |
| `privateIssueAiBillingGrant`                     | `private.issue_ai_billing_grant(uuid,text[],text,boolean,text)`                    |
| `publicAdminConsumeAiBillingGrant`               | `public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)`                 |
| `privateConsumeAiBillingGrantAndStartOperations` | `private.consume_ai_billing_grant_and_start_operations(uuid,text,uuid,jsonb,text)` |
| `publicAdminAuthorizeAiMaster`                   | `public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)`                    |
| `publicAdminIssueAiBillingGrantFromMaster`       | `public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)`      |

The C1 migration already revoked `service_role` EXECUTE from the private
`authorize_ai_master` and `issue_ai_billing_grant_from_master` functions, so
those private implementations are not counted as current effective admission
paths. This inventory follows effective `service_role` reachability rather
than counting every retained implementation function.

Each ACL object records `functionExists = true` plus exactly `publicExecute`,
`anonExecute`, `authenticatedExecute` and `serviceRoleExecute`. A missing,
dropped or renamed signature is not equivalent to retirement and is rejected,
because historical FK/audit compatibility requires all six retained
functions. Presence of any
still-runtime-reachable historical admission path remains an explicit `HOLD`
for Production. This source/local readiness tranche does **not** revoke,
rename, drop or execute any of them.

Billing retirement is a later, separately reviewed default-OFF migration only
after personal-AI-PIN local and Hosted/Human evidence. Its application and the
subsequent `BILLING_PIN` secret deletion require distinct approvals. Safe
status, stop, revoke, accounting and historical FK/audit integrity must remain
available and are explicit billing-retirement snapshot fields; rollback never
restores shared billing admission.

## 8. Staging Hosted/Human checklist

The following checklist may be executed only after its own approval. No paid
provider call is implied; paid traffic remains separately authorized.
Every Human result must be timestamped strictly after the Hosted revision
observation it exercises.

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

An external approval artifact is valid only when it binds the exact source SHA,
staging environment, requested action, expiry and rollback revision. The
closed manifest deliberately stores only that artifact's
`evidenceDigestSha256`, `state` and `recordedAt` under the separately named
approval slot. It never stores an approver identity or operational target.
The validator checks the record shape, state and ordering; the independent
reviewer must verify the digest binding, scope and expiry because the validator
cannot infer them from the digest. An approval is never inferred from a green
test, earlier plan approval or another action's approval. The following are
separate stop points:

| Approval                           | Effect if granted                                                                                              | Does not authorize                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `stagingHostedMutation`            | Apply the reviewed default-OFF revision/configuration to the named staging environment.                        | OAuth/provider changes, Human enrollment, cutover, deletion or activation.     |
| `oauthProviderConfiguration`       | Configure the exact staging Google/Supabase callback, Origin and consent contract.                             | Invitations, Human execution, cutover, secret deletion or Production use.      |
| `stagingHumanIdentityRun`          | Use the named role slots for the bounded Human matrix.                                                         | OAuth edits, paid calls, E cutover or secret deletion.                         |
| `googleOnlyCutover`                | Invoke the reviewed E operator transaction using the independently verified deployment digest.                 | Deleting `ADMIN_PIN`, billing retirement or enabling a canary.                 |
| `adminPinSecretDeletion`           | Delete only the obsolete Hosted `ADMIN_PIN` secret after post-cutover proof.                                   | Billing changes or activation.                                                 |
| `legacyBillingAuthorityRetirement` | Apply the separately reviewed default-OFF retirement migration.                                                | Deleting `BILLING_PIN` or enabling paid AI.                                    |
| `billingPinSecretDeletion`         | Delete only `BILLING_PIN` after retirement and rollback evidence.                                              | Paid traffic or Production activation.                                         |
| `limitedIdentityCanary`            | Enable only the approved bounded staging/identity cohort with named stop conditions.                           | Repository publication, contest access, commercial release or Phase 7.33 PASS. |
| `productionActivation`             | Reserved for the later integrated Phase 7.33 approval record and required to remain `HOLD` throughout Phase F. | Any Phase F execution or readiness elevation.                                  |

Chronology is part of the contract. Hosted deployment, the read-only
`preCutover` snapshot and the required Human identity/MFA/recovery evidence
must precede the distinct `googleOnlyCutover` approval, which must precede
`postCutover`. That proof must precede the
`adminPinSecretDeletion` approval and `ADMIN_PIN.removedAt`. Personal AI PIN
end-to-end proof plus the candidate-SHA local browser/static evidence and
independent source review must then precede the billing-retirement approval
and its read-only snapshot. Both billing retirement and rollback rehearsal must
precede the billing-PIN deletion approval and `BILLING_PIN.removedAt`. Every
non-HOLD approval uses a distinct digest; reusing one artifact across approval
slots is rejected.
The pre-cutover, post-cutover and billing-retirement snapshot digests must also
be pairwise distinct; copied evidence cannot represent separate observations.

External publication, contest invitations, paid-provider traffic and
legal/commercial acceptance remain outside this table and require their own
later approvals. `productionActivation` is represented only so Phase F can
prove it remains `HOLD`; it cannot be granted here. An expired, missing,
late-recorded, reused or scope-mismatched external approval causes `HOLD`; the
independent review must record that disposition when the closed manifest alone
cannot distinguish it.

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

Even `READY_FOR_SEPARATE_HOSTED_EXECUTION` only means that, after all supplied
staging Hosted/Human evidence passes internal consistency and independent
review, the next separately approved external step may be requested. The
validator does not independently query or prove that external state, execute
the next step, authorize Production or reduce the Phase 7.33 integrated Gate.
