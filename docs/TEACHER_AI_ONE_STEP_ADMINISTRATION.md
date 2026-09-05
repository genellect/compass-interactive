# One-step teacher and AI administration

Status: Implementation in progress; not yet deployed
Approved: 2026-09-05
Baseline: `3354582eb8b17a510a27422cdfb356944d400237`

## Required outcome

The Owner must not perform an entitlement operation followed by a separate AI
policy operation. One CTA and one exact-intent TOTP confirmation must cover the
complete requested change. The ordinary instructor never gains Owner authority.

- New teacher: enter the Google email, choose AI access and review its limits,
  then create the invitation with one confirmation. Invitation lifetime remains
  48 hours; membership has no expiry. The invited teacher completes their own
  Google/TOTP enrollment. Accepted AI-enabled invitations attach the approved
  policy automatically; no subsequent Owner policy operation is required.
- Existing teacher without AI: one operation enables AI and installs its policy
  in the same transaction. A failure rolls back both effects.
- Existing AI-enabled teacher: one operation configures or renews the policy;
  it must not toggle membership off/on or require another entitlement operation.
- The Owner reviews USD3/lecture and USD6/day defaults, with 30-day policy
  validity, 90 caption minutes/lecture and 180/day. These are editable application
  ceilings, not an automatic provider charge or a change to existing policies.
- The teacher list distinguishes actual policy coverage from mere entitlement.
  Missing or expired policy must not be presented as completed AI activation.

## Implementation boundary

Reuse the existing ledger payload digest, request ID, Owner control proof,
receipt, membership and AI-policy tables. Include immutable policy terms in the
invitation/enable-AI intent. Apply invitation policy in the same transaction as
the verified acceptance, bound to its exact accepted membership and environment.
Pending MFA membership cannot use AI before normal AAL2 activation.

Do not chain two independently authorized browser mutations, invent another MFA
protocol, weaken the server checks, or extend a session. Keep the existing
`ready -> control -> completing -> authorized` recovery sequence: the five-minute
proof begins on code submission, not while the form is displayed. Exact response
recovery does not repeat an already successful TOTP verification.

Ordinary Google/TOTP Admin sessions retain the existing absolute cap of backing
`auth.sessions.created_at + 8 hours`, without idle timeout. AI grants do not
revoke, reissue or extend those sessions. Explicit account switching is distinct
from restoration of the same account. Normal lecture AI CTAs require no new
Google, PIN or TOTP prompt.

## Verification and release

Run focused source, Edge, database and browser tests before one batched required
CI candidate. Prove atomic rollback, exact replay, payload tampering rejection,
expired/revoked invitation denial, same-environment membership binding,
instructor-only targeting, Owner-only mutation and unchanged session expiry.
Do not infer Production success from local fixtures.

Production rollout is additive migration, affected Edge, then same-SHA Pages.
Verify the real Owner UI and the ordinary teacher lecture AI path, including one
bounded real material analysis, deliberate publication, automatic student UI
arrival and reload persistence. No live test bypasses membership, policy,
quality, budget, ownership or lifecycle checks. Secrets and private account
identifiers stay outside this public repository.

The real five-minute summary path must also retain the provider output limit in
both child-grant and operation-start RPCs. The reservation's
`estimatedOutputTokens` is the bounded provider maximum; a missing property must
not silently disappear from serialized RPC arguments and appear as an
authorization failure. Test the wire binding as well as helper calculations.
