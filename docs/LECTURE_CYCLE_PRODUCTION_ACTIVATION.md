# Lecture Cycle Production activation

Status: Implemented, verification pending

Scope: Canonical Production lecture cycle for Educator, Student, Display, Review, PDF and browser AI paths
Last verified: 2026-08-20

## Purpose

This runbook promotes the existing Production environment directly. It does not
create a contest-only or staging replacement. The release is complete only when
the canonical browser UI can create a lecture, publish a PDF, start the lecture,
admit a student, open Display, exercise every enabled AI surface, stop those
surfaces and close the lecture.

The formal Phase 7.33 commercial gate remains separate. Public-source release,
300-person SLA, multi-tenant operation, signed Presenter hardware, DPA/legal and
general availability are not implied by this lecture-cycle activation.

## Non-negotiable invariants

- Production mutations use the exact reviewed source revision and one green
  required CI run. A previously green ancestor is supporting evidence, not the
  release result.
- Migrations are expand-first. On the Free plan, recovery is repair-forward; no
  destructive down migration is assumed.
- Edge and database admission are enabled before the matching browser CTA is
  exposed. Status, stop, close, revoke and downgrade remain available when new
  admission is disabled.
- Google plus TOTP is the Educator identity. An app session is capped by the
  backing Supabase Auth session's eight-hour absolute lifetime.
- Environment AI policy is membership-scoped. Every active membership marked
  AI-capable must have one current, canonical policy before the topology is
  considered complete. The database-owned predicate pins the five actions,
  two models, 24/96 call limits, 200k/800k input limits, 40k/160k output
  limits, 90/180 realtime-minute limits, concurrency 2, exact 30-day lifetime,
  and cost ceilings of USD 0.01–5 per lecture and no more than USD 20 per day.
  Policy creation consumes the existing request-bound, five-minute TOTP
  control grant; raw table writes are forbidden.
- The verified Google plus TOTP AAL2 app session, active AI-enabled membership,
  exact lecture ownership and current policy prove one-click lecture-wide AI
  intent. The ordinary CTA does not ask for an AI PIN or another TOTP. Every
  actual provider dispatch still consumes a short-lived child grant and
  rechecks lecture state, scope, budget, concurrency and idempotency.
- Secrets, app-session tokens, OAuth material, lecture codes and personal data
  never enter Git, CI logs, evidence JSON or this runbook.

## Core topology

The complete lecture-cycle gate requires all core frontend and server feature
flags defined by `validateCompleteLectureProductionTopology`, the Google Admin
database gates, two active owners, current required Edge revisions, Worker PDF
upload, and full AI-policy coverage. Optional Presenter hardware,
remembered-browser convenience and TOTP factor mutation remain independent and
may stay off without hiding or weakening the browser lecture cycle.

The redacted runtime proof is complete only when
`activeAiMembershipCount > 0`, `coveredAiMembershipCount` is exactly equal to
it, both `aiPolicyTopologyComplete` and
`canonicalAiPolicyTopologyComplete` are true, and the exact five-action and
two-model inventories match. A positive aggregate policy count alone is not
activation evidence.

## Release sequence

1. Freeze one candidate SHA. Run targeted type/static/browser checks locally,
   then one required exact-head CI run. Do not spend Actions on intermediate
   commits.
2. Collect a redacted read-only Production inventory. Confirm the canonical
   environment, current migration/function revisions, two active owners, no
   active lecture, no pending provider work, and the current flag/gate/policy
   counts. A mismatch is HOLD.
3. Apply only the reviewed expand-first migrations. Verify migration history,
   generated public types and the read-only inventory before continuing.
4. Deploy the exact required Supabase Edge functions with production secrets
   already present. Keep new AI master and child admission off until policies
   are ready; verify identity, status, stop and revoke first.
5. Deploy the canonical Pages build with the complete frontend topology. The
   Admin workspace fails closed if Google operational admission is absent.
6. In Educator management, an owner configures the bounded policy for every
   active AI-capable membership. Each change uses a fresh authenticator proof,
   exact intent digest and idempotent request ID. Verify full membership-policy
   coverage before enabling paid admission.
7. Confirm each testing instructor has a current Google plus TOTP AAL2 app
   session and an active AI-enabled membership. Enable database AI-master
   admission and child grants only after policy coverage, provider secrets,
   current Edge revisions and stop paths all pass. Retain the old PIN/browser
   transports only for repair-forward rollback; do not expose them in the
   ordinary lecture UI.
8. Run one bounded canonical browser lecture. Use the UI, not direct API calls:
   PDF selection and publication, lecture start, Student join, Display claim,
   page sync, Poll/comment paths, one-click AI master admission, captions,
   material analysis, poll suggestions, summaries and academic answers,
   followed by every stop and lecture close. Record only redacted
   stage/result/timing and bounded cost.
   For cross-student comments and likes, record at least twenty UI-observed
   samples for each path. The hosted p95 target is five seconds and no
   individual sample may exceed the ten-second reliability ceiling. The local
   lifecycle records each latency and uses a ten-second bounded UI wait; test
   runner scheduling is not a substitute for the hosted wall-clock p95 sample.
   The periodic snapshot count must remain at the established five-second
   envelope.
9. Confirm zero open lectures, zero running AI/provider work, no unexpected
   duplicate usage, no console/page errors, and no secret or personal-data
   exposure. Preserve the exact deployment and test evidence privately.

## Immediate stop conditions

Stop new admission and preserve status/stop/close access if any of the
following occurs:

- source, Pages, migration or Edge revision drift;
- owner recovery, TOTP, ownership or cross-lecture authorization failure;
- PDF publication succeeds but Student or Display does not receive the active
  document/page;
- Student join stalls, duplicates a participant, or accepts a closed lecture;
- an AI CTA reaches a provider without policy/master/child authorization;
- unexpected duplicate provider calls, budget overrun, stale completion after
  stop/close, or inability to stop/revoke;
- console/page error, authentication loop, serious accessibility failure or
  mobile horizontal overflow on the canonical path.

## Repair-forward and rollback

1. Disable new AI child admission, then master admission. Preserve status,
   stop, close, revoke and downgrade.
2. Disable the affected server feature flag and matching frontend exposure.
   Do not leave an enabled CTA pointing at a disabled server path.
3. Route Pages to the previous immutable revision if the browser bundle is the
   fault. Do not restore shared Admin PIN transport.
4. Repair additive database or Edge defects forward, rerun the read-only
   inventory and repeat only the smallest failed bounded canary.
5. Re-enable in server-to-browser order only after the stop condition is
   resolved on the exact repaired revision.

## Completion statement

The only valid completion claim is `LECTURE_CYCLE_PRODUCTION_ACTIVE`, recorded
after the exact deployed revision, complete topology, canonical UI lecture and
post-close drain all pass. Source merge, CI, migration, Pages deployment or
individual API success alone cannot produce that claim.
