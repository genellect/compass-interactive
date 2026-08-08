# Agent Execution and Reasoning Routing

Status: Planned
Scope: agent responsibilities and reasoning budget for Phase 7.29 onward
Last verified: 2026-08-08

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

| Phase | Primary | Independent review | Reason |
| --- | --- | --- | --- |
| Cloud Canonicalization | Extra High | Ultra final contract review | Broad repository policy, low product-runtime mutation |
| 7.29A PPT rescue | **Ultra** | Native/COM, DB/RLS, Edge/token and UX/CI tracks; external Claude Code Opus Max recommended | Reconstructs an ahead-only native/security boundary on a changed main |
| 7.29B dormant placement | **Ultra** | Supabase/Edge/Cloudflare read-only evidence review | Multi-service sequencing and rollback must prove zero activation |
| 7.29C signed activation | **Ultra** | External Claude Code Opus Max plus Windows/Office and security specialists | Code signing, COM/STA, localhost/PNA, installer and venue risks intersect |
| 7.30A Google asset audit | **Ultra** | External IAM review recommended | Existing COMPASS assets must be separated into safe reuse and Interactive-only credentials |
| 7.30B identity/MFA foundation | **Ultra** | Authentication threat-model and account-recovery review | OAuth, AAL2, session issuance and bootstrap create a new trust root |
| 7.30C RBAC/admin ledger | **Ultra** | RLS/ownership/concurrency review | Owner, co-admin, AI entitlement, revoke and audit must remain server-authoritative |
| 7.30D Admin UX migration | Extra High | Ultra security and accessibility review | UI work is bounded once the identity contract is fixed |
| 7.30E compatibility migration | **Ultra** | Old-client and rollback review | PIN-to-Google expand-first coexistence must avoid lockout or privilege expansion |
| 7.30F Hosted/Human/Production Gate | **Ultra** | External final read-only review strongly recommended | Exact hosted state, MFA, recovery, two-admin separation and rollback decide release safety |

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

Google login replaces only the Admin login PIN after the compatibility gate.
The independent API-use/Billing PIN for starting paid AI work remains unless a
future explicitly approved contract replaces that step-up control.
