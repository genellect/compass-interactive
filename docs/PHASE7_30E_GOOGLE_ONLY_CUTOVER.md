# Phase 7.30E Google-only Admin Cutover

Status: Phase 7.30E Google-only application source and dormant database
authority are merged and their database/runtime/browser regressions were
revalidated by the green Phase 7.30F main CI `31721099011` at exact main
`7526fb03e8b7b05501d65b1f70d1f4c32afc2b2e`. The irreversible database cutover,
Hosted deployment, Hosted secret deletion and real-account activation are not
executed and remain Human/Hosted HOLD.

## Delivered boundary

The current Admin application accepts only a verified Google Admin application
session. The shared Admin PIN UI, issuer, client storage, feature flags and the
`verify-admin-pin` and `authorize-ai-start` Edge entries are removed. All 19
remaining operational Admin Edge adapters require `appSessionToken`, reject
legacy `adminToken`, `billingPin` and `billingGrant` request fields, and use the
closed Google authorization policy matrix. Admission flags may stop new or
elevating authority, but status, stop, close, revoke and other explicitly safe
controls remain available.

The personal four-digit AI PIN is unchanged. It is an intent factor inside a
valid Google plus TOTP AAL2 Admin session and cannot sign in an Admin, change a
role or recover an owner. Direct shared-billing compatibility is a separate
retirement boundary and is not represented as complete by this tranche.

Display capabilities now require durable Google issuance provenance for both
live-invalid terminal downgrade and cryptographically expired terminal access.
An exact JTI hash, lecture, issued/expires bounds and anonymous Display Auth UID
are rechecked transactionally. Unknown legacy descendants and cross-UID claims
fail closed.

## Dormant database authority

Migration application alone changes no active identity and creates no cutover
tombstone. The authority migration adds three private, RLS-protected,
append-only evidence tables:

- operator-reviewed lecture ownership approvals;
- exact-replay ownership claim receipts; and
- one global Google-only identity cutover receipt.

Existing lecture ownership is never inferred from a request, title, creator or
email. A postgres operator must approve an exact environment, lecture,
principal and membership mapping, including the expected lecture status and
lifecycle version. The claim accepts only the approval and request IDs, locks
the canonical authority and descendant tables, and stores
`ownership_source = 'operator_claim'` atomically. Existing Google-created
ownership remains `ownership_source = 'google_create'`.

The final operator function requires a SERIALIZABLE transaction, the shared
environment/request mutexes and a 64-hex digest of independently verified
Hosted deployment evidence. It takes `ACCESS EXCLUSIVE NOWAIT` locks and
rechecks, in the same transaction:

- a current active environment with at least two active owners;
- Google session, operational and ledger gates enabled;
- zero unowned or invalid draft/open lectures;
- zero active legacy session after terminal revocation; and
- zero unresolved legacy master, grant, usage, summary, Academic-answer or PDF
  descendant authority.

Only then does it disable legacy admission, revoke active legacy sessions,
remove service-role execution of the legacy verifier and append the immutable
tombstone. Post-cutover triggers prevent re-enabling the legacy gate,
resurrecting or extending a legacy session, creating a new legacy session, or
committing a draft/open lecture without explicit ownership. Exact committed
replays remain readable.

## Activation and rollback boundary

SQL cannot prove that an already-deployed stateless legacy Edge bundle has been
removed. Therefore the operator function must not be called until the Hosted
application and every Admin Edge deployment are confirmed Google-only and the
deployment evidence digest is independently recorded. Removing a source
directory does not itself undeploy a Hosted function or remove a secret.

Rollback never restores a shared PIN. It uses a reviewed immutable Google-only
application revision, keeps append-only identity/ownership/audit evidence and
uses documented Supabase operator owner recovery. Admission may be disabled
while safe status, stop and revoke remain available.

`BILLING_PIN` is absent from active application/Edge source, and no operational
Admin adapter accepts `billingPin` or `billingGrant`. The identity cutover does
not delete historical compatibility RPCs or historical grant/master rows.
Retiring their service-role authority is a separate default-OFF migration after
personal-AI-PIN local and Hosted/Human evidence. Historical rows may remain
only for foreign-key, accounting and audit integrity.

## Evidence required before operator cutover

- fresh migration apply, generated-type drift check and database lint;
- dedicated pgTAP for RLS/ACL, approval/claim exact replay, tombstone and
  session/lecture fences;
- populated C2-head and D-head upgrades without inferred evidence;
- two-connection claim/session/cutover serialization and NOWAIT failure;
- Google AAL2 Local Edge and desktop/mobile Chromium/WebKit Admin flows;
- complete Phase 0-7.29 regression with no legacy Admin wire field; and
- independently reviewed Hosted release, function inventory, secret inventory,
  two-owner recovery rehearsal and immutable rollback revision.

The repository test gate does not authorize Hosted mutation, OAuth changes,
secret deletion, real invitation delivery, paid provider traffic or Production
activation.
