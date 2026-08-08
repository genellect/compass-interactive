# Agent Execution and Reasoning Routing

Status: Planned
Scope: agent responsibilities and reasoning budget for Phase 7.29 onward
Last verified: 2026-08-09

## General rule

Use the highest reasoning budget that produces a measurable risk reduction.
Extra High is the default for bounded implementation and deterministic tests.
Ultra is required when independent security, lifecycle, native, cost or
Production evidence streams must be reconciled by one decision owner.

The primary implementation agent owns requirements integration, shared source,
migrations, final browser checks, commits, PR integration and deployment.
Subagents and external reviewers are read-only by default and never receive
Production secrets or independent deployment authority.

## Recommended routing

| Phase                                            | Primary                                                                   | Independent review                                                                         | Reason                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Canonicalization                           | Extra High                                                                | Ultra final contract review                                                                | Broad repository policy, low product-runtime mutation                                                                                                                       |
| 7.29A PPT rescue                                 | **Ultra**                                                                 | Native/COM, DB/RLS, Edge/token and UX/CI tracks; external Claude Code Opus Max recommended | Reconstructs an ahead-only native/security boundary on a changed main                                                                                                       |
| 7.29B dormant placement                          | **Ultra**                                                                 | Supabase/Edge/Cloudflare read-only evidence review                                         | Multi-service sequencing and rollback must prove zero activation                                                                                                            |
| 7.29C signed activation                          | **Ultra**                                                                 | External Claude Code Opus Max plus Windows/Office and security specialists                 | Code signing, COM/STA, localhost/PNA, installer and venue risks intersect                                                                                                   |
| 7.30A asset/IAM/threat inventory                 | **Ultra**                                                                 | External IAM and threat-model review recommended                                           | COMPASS design assets, environment boundaries, credentials, roles, recovery and cost-control policy must be fixed before code                                               |
| 7.30B additive identity and AI-unlock foundation | **Ultra**                                                                 | Supabase Auth/RLS, token-storage, account-recovery and factor-abuse review                 | B1 must prove separate Admin client, trusted Google binding and mandatory TOTP before B2 adds AI PIN, browser credential, rate-limit state, policy and master provenance    |
| 7.30C RBAC and all server authorization          | **Ultra**                                                                 | RLS/ownership/concurrency/cost review                                                      | Capability, lecture ownership, all Edge/RPC checks, revoke, last-owner, AI policy and lecture master authorization must remain transaction-authoritative                    |
| 7.30D Google/MFA/AI-unlock/Admin-ledger UX       | Extra High                                                                | Ultra security and accessibility review                                                    | UI work is bounded once the identity and AI-intent contracts are fixed                                                                                                      |
| 7.30E dual-read compatibility and regression     | **Ultra**                                                                 | Old-client, backfill and rollback review                                                   | PIN-to-Google coexistence, ownership backfill, full Phase 0-7.29 regression and break-glass retirement must avoid lockout or privilege expansion                            |
| 7.30F Hosted/Human identity migration gate       | **Ultra**                                                                 | External final read-only review strongly recommended                                       | Exact hosted state, MFA, recovery, two-admin separation and rollback decide whether Google enforcement may replace shared PIN login; this is not the Phase 7.33 formal gate |
| 7.31A GitHub governance                          | **Ultra**                                                                 | Independent supply-chain and repository-governance review                                  | Rulesets, release authority and history exposure determine whether later publication is safe                                                                                |
| 7.31B public-source readiness                    | **Ultra**                                                                 | External history/secret/license review                                                     | Visibility is difficult to reverse and exposes every reachable Git surface                                                                                                  |
| 7.31C contest environment                        | **Ultra**                                                                 | Independent identity/isolation/cost review plus human reviewer E2E                         | Real `instructor + can_use_ai` access must remain isolated from Production without a mock bypass                                                                            |
| 7.32 commercial readiness                        | **Ultra** for tenancy/security/operations; Extra High for bounded UX work | External security, privacy, accessibility and reliability review                           | Multi-tenant EdTech operation combines authorization, legal, support, SLO and cost contracts                                                                                |
| 7.33 unified Production Gate                     | **Ultra**                                                                 | External final review and human owner approval                                             | One decision owner must reconcile every local, hosted, device, human and publication evidence stream                                                                        |

Several narrow documentation or visual tasks may be combined under one Extra
High phase when they touch no shared authorization or lifecycle contract.
Google identity, Presenter activation and Production sequencing must not be
combined merely to reduce phase count.

## External reviewer boundary

An external agent such as Claude Code Opus Max can review the exact diff,
threat model, tests and redacted evidence. It must not:

- read or receive secret values, recovery codes, personal lecture data or
  Production database exports;
- edit the same branch concurrently with the primary agent;
- approve its own changes;
- perform Hosted mutations or paid calls;
- substitute for human MFA, device, venue or accessibility acceptance.

Findings are triaged by severity. Critical/High findings block the phase;
Medium findings require a documented fix or explicit later-phase disposition.

## Google authentication reuse boundary

The existing COMPASS Google platform is a design reference, not a credential
bundle. Reusable concepts include exact-email bootstrap, immutable Google
subject binding, create-only owner bootstrap, append-only audit and a distinct
OAuth audience. Potentially reusable account resources such as billing,
verified domain and consent branding require a read-only Cloud Console audit.

Interactive receives its own OAuth client, callback/origin allowlist, Supabase
provider secret, service identities, session secrets, rotation and rollback.
The existing COMPASS ID-token-per-request session model is not copied because it
does not provide Interactive's required server session ledger, individual
revocation or application-enforced AAL2.

Google login replaces the Admin login PIN after the compatibility gate. The
future normal paid-AI path is Google plus AAL2, active membership,
`can_use_ai`, an owner-managed server policy, a personal four-digit AI PIN (or
its valid remembered-browser proof), and one explicit lecture master CTA. A
purpose-bound AI Passkey is a later alternative after its WebAuthn gate. The
exact choices remain `all_except_captions` and `all_including_captions`; every
child provider start still rechecks lecture lifecycle, policy scope, budget,
concurrency and idempotency. The four-digit factor is accepted only inside AAL2
with atomic rate limiting and lockout. Browser remembering stores only a
revocable browser-profile-bound credential backed by a non-extractable key, not
a raw PIN; enrollment consumes a short-lived nonce bound to identity,
membership, session, exact TOTP step-up, factor version, Origin and key
fingerprint. Hardware binding is not claimed before WebAuthn. Caption-scope
escalation requires a new AI proof and recent TOTP step-up; downgrade/stop are
free. `ADMIN_PIN`, `BILLING_PIN` and personal `AI PIN` remain non-interchangeable:
legacy login, default-OFF verified-owner paid rollback and normal intent factor,
respectively.

The authoritative Phase 7.30 implementation contract is
[`PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md`](PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md).
Agents must read it before changing Google Auth, Admin sessions, roles, lecture
ownership or MFA.

The authoritative contest-publication and commercial-readiness contract is
[`PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md`](PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md).
Agents must read it before changing repository visibility, rulesets, reviewer
access, contest infrastructure, tenancy, commercial operations or the Phase
7.33 Production Gate. A contest reviewer uses the ordinary `instructor +
can_use_ai` path in an isolated real environment; the reviewer is not an owner,
secret viewer, shared account or mock-only role.
