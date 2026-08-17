# Phase 7.30D Admin Ledger

Status: default-OFF source and exact-head database/Edge/browser evidence PASS.
Hosted activation, real invitation delivery and Human evidence remain HOLD.

## Delivered boundary

Phase 7.30D adds an owner-only management surface without replacing or blocking
the lecture workspace. It covers:

- content-free environment membership, invitation, session, lecture ownership
  and bounded audit snapshots;
- invitation issue/revoke and redemption into an existing or new principal;
- owner promotion/demotion, membership suspension/reactivation/revocation and
  AI entitlement enable/disable;
- one-session and one-membership global application-session revocation;
- last-active-owner protection and immediate draining of affected sessions,
  personal AI factors, remembered-browser authority and lecture masters.

The current `/admin/settings` UI is `教員管理`, not a general environment
configuration console. Its primary surface is a table for granting, suspending
or revoking teacher access, changing instructor AI access, and revoking active
logins. It also keeps active-lecture emergency stop and a focused list of
denied/failed operations visible. Full history, invitation history and personal
`AI PINの設定` are secondary disclosures.

New UI invitations are always `instructor`, have no membership expiry and use
one fixed 48-hour link lifetime. Their AI entitlement defaults to disabled and
must be selected explicitly. The UI never offers Owner promotion or an Owner
invitation. Existing Owners remain visible as `管理者（全権限付与）` and the
database/Edge owner invariants and operator recovery contracts remain intact;
removing the elevation control from the ordinary UI does not weaken those
server-side contracts.

The database serializes writes by environment and request, rechecks actor and
target authority under canonical locks, and consumes a five-minute TOTP control
grant bound to operation key, request ID and canonical payload digest. Exact
replay returns one immutable result; changed binding fails closed.

## Invitation privacy and recovery

The Edge derives one high-entropy invitation token from the environment,
request and target email HMAC using a separate server secret. Only its SHA-256
hash reaches the database. Raw email and token material are excluded from
receipts, audit and browser recovery storage. Acceptance terminalizes the
invitation and writes one append-only redemption receipt in the same
transaction as membership creation.

The browser stores only bounded recovery metadata for an unfinished owner
mutation: action, payload, request ID, canonical intent digest, operation key,
selected factor ID, control nonce and phase. It stores no TOTP code, raw
invitation token, Google bearer or app-session token. Logout/session invalidation
clears this recovery state.

## Rollback and gate contract

`VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER`,
`PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED` and the database ledger gate default
OFF. New/elevating operations remain disabled when admission is OFF, while
snapshot, audit, demotion, suspension, revoke, AI disable and session revoke
remain available. This keeps safe recovery usable without re-enabling shared
Admin or billing PIN paths.

## Integration evidence

- fresh migration apply, generated types and DB lint: PASS;
- all pgTAP including the dedicated D authority test: PASS;
- two-connection last-owner and invitation accept/revoke convergence: PASS;
- populated invitation upgrade without fabricated identity or redemption data:
  PASS;
- Local Edge CORS/auth/strict-body checks: PASS;
- Chromium and WebKit desktop/mobile browser coverage, including response-loss
  recovery, flag-OFF safe controls, no anonymous/legacy PIN transport,
  accessibility and horizontal-overflow checks: PASS; and
- independent freeze review and one exact-head CI run: PASS.

Hosted OAuth/provider settings, real invitations, production secrets, legacy
database cutover, external publication and activation are not authorized by
this document and remain Phase 7.30E-F/Human gates.
