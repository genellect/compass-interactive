# Phase 6.5 Requirements and Threat Model

Date: 2026-07-16

## Trust boundaries

| Boundary | Rule |
| --- | --- |
| Student browser -> Supabase | Treat body and nickname as untrusted data |
| Participant UUID -> ownership | Authorization remains bound to `auth.uid()` by Phase 0 RLS |
| Nickname -> identity | Never treat a nickname as identity, ownership, or authentication |
| Snapshot/archive -> student | Return nickname only after existing lecture membership checks |
| Demo browser -> live backend | Demo nickname operations must remain local-only |
| Comment text -> AI provider | Nickname is excluded from provider input |

## Threats and controls

| Threat | Control | Verification |
| --- | --- | --- |
| Student impersonates another participant UUID | Existing participant ownership RLS; role-only authorization is insufficient | pgTAP two-user spoof rejection |
| Nickname bypasses lecture close | Existing server-side open-state predicate applies to the same row insert | pgTAP closed-lecture rejection |
| Cross-lecture nickname disclosure | Existing snapshot/history/archive membership cores run before enrichment | pgTAP unrelated-user archive rejection |
| Hidden identity/profile table increases correlation | No profile, preference, or nickname table | migration/static scan |
| Extra Realtime load | `comments` remains outside the Realtime publication | pgTAP and static scan |
| Extra write or version bump | Nickname travels in the existing insert; existing trigger bumps once | pgTAP version deltas |
| Oversized or control-character nickname | Frontend normalization plus DB `CHECK` | unit test and pgTAP boundaries |
| Empty string becomes pseudo-identity | Empty/whitespace normalizes to `NULL`; DB rejects direct empty string | unit test and pgTAP |
| Stored XSS | React text rendering; no nickname HTML insertion | code review and production build |
| Unicode confusable names | Names are display-only, non-unique, and non-authoritative | documented product contract |
| Personal data entered as nickname | UI warns not to enter personal information; 10-character limit minimizes exposure | UI review |
| Nickname sent to OpenAI | AI context builders do not consume nickname | static/code review |
| Demo accidentally calls Supabase | Demo repository has no Supabase/fetch/RPC call path | static and repository tests |
| Live feature enabled prematurely | Phase 1-dependent feature flag defaults OFF | env/static test |
| Old comments fail after migration | Nullable column with no default; old rows remain `NULL` | upgrade pgTAP |
| Old clients break on expanded JSON | Existing RPC signatures remain; added property is ignorable | all SQL regression and upgrade pgTAP |
| Browser updates nickname after posting | Authenticated role has no comment `UPDATE` privilege | pgTAP privilege test |

## Accepted limitations

- A participant may choose the same nickname as another participant.
- A nickname can be misleading because it is not a verified identity.
- Confusable Unicode characters are not rejected; uniqueness and identity
  semantics would create more privacy and moderation cost than educational
  value.
- Existing comment moderation hides the complete comment and nickname
  together. There is no independent nickname moderation record.

## Security invariants

1. `NULL` is the only canonical anonymous value.
2. `匿名の参加者` is a presentation fallback, not stored identity data.
3. A nickname never changes RLS, ownership, like ownership, Poll ownership, or
   AI admission.
4. Public RPCs remain `SECURITY INVOKER`.
5. Private Definer code has fixed empty `search_path` and no direct browser
   execute grant.
6. API keys and service-role credentials remain absent from browser code.
